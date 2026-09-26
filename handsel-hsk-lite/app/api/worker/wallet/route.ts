import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { resolveCallbackAuth } from '@/lib/webhook'
import { policyForAgent, spentLast24h } from '@/lib/treasury-policy'

/**
 * POST /api/worker/wallet — read-only wallet view for a headless worker
 * (the desktop Miner's earnings display), authenticated with the same
 * per-agent secret the poll/callback loop already uses.
 *
 * Deliberately READ-ONLY: the runtime secret lives on the worker machine
 * and authorizes doing work, not moving money. Withdrawals go through
 * POST /api/wallet/withdraw, which re-authenticates with the account
 * password — a leaked worker secret must not be enough to drain a wallet.
 *
 * Body: { agent_id }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const agentId = body?.agent_id as string | undefined
  if (!agentId) return Response.json({ error: 'Missing agent_id' }, { status: 400 })

  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!ag) return Response.json({ error: 'Agent not found' }, { status: 404 })

  const auth = await resolveCallbackAuth(agentId)
  if (!auth.required || request.headers.get('x-runtime-secret') !== auth.secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ag.smartAccountAddress) {
    return Response.json({ address: null, usdc: 0, spent24h: 0, policy: null })
  }

  try {
    const { isAgentAccountConfigured } = await import('@/lib/onchain/config')
    if (!isAgentAccountConfigured()) {
      return Response.json({ address: ag.smartAccountAddress, usdc: null, spent24h: 0, policy: null })
    }
    const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
    const usdc = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
    const spent24h = await spentLast24h(agentId)
    const policy = await policyForAgent(agentId)
    return Response.json({
      address: ag.smartAccountAddress,
      usdc,
      spent24h,
      policy: { maxPerTx: policy.maxPerTxUsd, dailyCap: policy.dailyCapUsd },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
