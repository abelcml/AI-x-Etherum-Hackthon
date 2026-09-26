import { db } from '@/lib/db'
import { user, agent } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { isValidAddress } from '@/lib/treasury-policy'
import { sweepAgentToAddress, type SweepResult } from '@/lib/treasury-sweep'

export const maxDuration = 120 // one on-chain transfer per owned agent, worst case

/**
 * POST /api/wallet/withdraw — headless earnings withdrawal (the desktop
 * Miner's "Withdraw" button; works for any scripted client too).
 *
 * Auth is a full email+password re-check — NOT the per-agent runtime
 * secret. The runtime secret lives on the worker machine and authorizes
 * doing work; a leaked one must never be enough to move money. Same
 * split the dashboard enforces (poll/callback vs. session-authed
 * treasury actions).
 *
 * Body: { email, password, to?, agent_id? }
 *   - to: destination address (e.g. a MetaMask account). Optional if the
 *     account already saved a payout address; when given, it is ALSO saved
 *     as the account's payout address for next time.
 *   - agent_id: sweep just this one agent (must belong to the account);
 *     omit to sweep every provisioned agent.
 *
 * Caps: the same per-account spending policy as every other withdrawal
 * path (user-set, else platform default) — enforced inside the shared
 * sweep, not re-implemented here.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')
  const toRaw = body?.to ? String(body.to).trim() : ''
  const agentId = body?.agent_id ? String(body.agent_id) : null

  if (!email || !password) {
    return Response.json({ error: 'email and password are required' }, { status: 400 })
  }

  // This endpoint is a password oracle that pays out on success — the worst
  // possible thing to leave unthrottled. Every other credential-taking route
  // (signin, register, personal-token) was already behind the durable
  // sliding window; this one was missed, so an attacker could guess at full
  // speed against the one endpoint whose reward is the funds themselves.
  // Counted BEFORE the bcrypt compare, so the limit applies to attempts
  // rather than to failures.
  const { authThrottled, throttleIp } = await import('@/lib/auth-throttle')
  if (await authThrottled('withdraw', throttleIp(request))) {
    return Response.json(
      { error: 'Too many withdrawal attempts from this address — wait a few minutes and try again.' },
      { status: 429 },
    )
  }

  const [u] = await db
    .select({ id: user.id, password: user.password, payoutAddress: user.payoutAddress })
    .from(user)
    .where(eq(user.email, email))
  if (!u?.password || !(await bcrypt.compare(password, u.password))) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const to = toRaw || u.payoutAddress || ''
  if (!to) {
    return Response.json(
      { error: 'No destination: pass "to" (a wallet address) or save a payout address on the dashboard first' },
      { status: 400 },
    )
  }
  if (!isValidAddress(to)) {
    return Response.json({ error: 'Invalid destination address' }, { status: 400 })
  }

  // Remember an explicitly-passed destination as the account's payout
  // address — the desktop app shouldn't need to re-send it every time.
  if (toRaw && toRaw !== u.payoutAddress) {
    await db.update(user).set({ payoutAddress: toRaw, updatedAt: new Date() }).where(eq(user.id, u.id))
  }

  const agents = agentId
    ? await db.select().from(agent).where(and(eq(agent.userId, u.id), eq(agent.id, agentId)))
    : await db.select().from(agent).where(eq(agent.userId, u.id))

  if (agentId && agents.length === 0) {
    return Response.json({ error: 'Agent not found on this account' }, { status: 404 })
  }

  const results: SweepResult[] = []
  const provisioned = agents.filter((a) => a.smartAccountAddress)
  for (let i = 0; i < provisioned.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000)) // bundler RPC rate limit
    const r = await sweepAgentToAddress(provisioned[i], to, 'Withdraw (headless)')
    if (r) results.push(r)
  }

  const totalSent = results.reduce((sum, r) => sum + r.sent, 0)
  return Response.json({ to, total_sent: totalSent, results })
}
