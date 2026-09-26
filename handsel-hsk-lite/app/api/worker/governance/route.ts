import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { resolveCallbackAuth, callbackSecretMatches } from '@/lib/webhook'
import {
  govSummary,
  listProposals,
  listPendingReviews,
  listVotingAgents,
  createLock,
  castVote,
  setAutoVote,
  resolveDelegateReview,
  type VoteChoice,
} from '@/lib/governance'

/**
 * POST /api/worker/governance — headless governance for the desktop Miner,
 * authenticated with the same per-agent runtime secret the poll loop uses.
 *
 * Unlike the wallet endpoint (read-only — a leaked worker secret must not
 * move USDC), governance is safe to act on with the runtime secret: the
 * worst a leaked secret can do is vote/lock the owner's EARNED $LEDGER,
 * which never leaves the platform and is bounded by what this account
 * contributed. Withdrawals still require the password.
 *
 * Body: { agent_id, action?, ...args }. action defaults to "view".
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const agentId = body?.agent_id as string | undefined
  if (!agentId) return Response.json({ error: 'Missing agent_id' }, { status: 400 })

  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!ag) return Response.json({ error: 'Agent not found' }, { status: 404 })

  const auth = await resolveCallbackAuth(agentId)
  if (!auth.required || !callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = ag.userId
  const action = (body?.action as string | undefined) ?? 'view'

  try {
    switch (action) {
      case 'view': {
        const [summary, proposals, reviews, agents] = await Promise.all([
          govSummary(userId),
          listProposals(userId, 20),
          listPendingReviews(userId),
          listVotingAgents(userId),
        ])
        // This agent's own delegate config, so the desktop can render its toggle.
        const me = agents.find((a) => a.id === agentId) ?? null
        return Response.json({
          summary,
          proposals: proposals.map((p) => ({
            id: p.id,
            title: p.title,
            open: p.open,
            closesAt: p.closesAt,
            tally: p.tally,
            yourVote: p.yourVote,
          })),
          reviews,
          me: me && { autoVote: me.autoVote, votePolicy: me.votePolicy, creditScore: me.creditScore },
        })
      }

      case 'lock': {
        const amount = Number(body?.amount)
        const weeks = Number(body?.weeks)
        await createLock(userId, amount, weeks)
        return Response.json({ ok: true })
      }

      case 'vote': {
        const proposalId = String(body?.proposal_id ?? '')
        const choice = String(body?.choice ?? '')
        if (!['for', 'against', 'abstain'].includes(choice)) {
          return Response.json({ error: 'choice must be for/against/abstain' }, { status: 400 })
        }
        const r = await castVote(userId, proposalId, choice as VoteChoice)
        return Response.json({ ok: true, power: r.power })
      }

      case 'review': {
        const proposalId = String(body?.proposal_id ?? '')
        const decision = String(body?.decision ?? '')
        if (!['accept', 'dismiss'].includes(decision)) {
          return Response.json({ error: 'decision must be accept/dismiss' }, { status: 400 })
        }
        const r = await resolveDelegateReview(userId, proposalId, decision as 'accept' | 'dismiss')
        return Response.json(r)
      }

      case 'set_auto_vote': {
        const enabled = body?.enabled === true
        const policy = String(body?.policy ?? '')
        await setAutoVote(agentId, userId, enabled, policy)
        return Response.json({ ok: true })
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
