import { db } from '@/lib/db'
import { agent, agentEvent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { enforceSpendingPolicy, isValidAddress, policyForAgent, spentLast24h } from '@/lib/treasury-policy'

export const maxDuration = 120

/**
 * POST /api/runtime/wallet — the agent's hands on its own wallet.
 * Called by the Python runtime (shared-secret authed) when the agent invokes
 * its send_usdc / wallet_balance tools mid-task. Every transfer passes the
 * spending policy and is recorded as a WALLET_TRANSFER behavioral event.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const action = body?.action as string | undefined
  const agentId = body?.agent_id as string | undefined
  if (!action || !agentId) return Response.json({ error: 'Missing action or agent_id' }, { status: 400 })

  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!ag?.smartAccountAddress) {
    return Response.json({ error: 'Agent has no smart account' }, { status: 404 })
  }

  // Authenticate against THIS agent's own key, and fail closed.
  //
  // Two problems with what stood here. It read
  // `if (expected && header !== expected)`, so an unset or emptied
  // RUNTIME_SHARED_SECRET skipped the check entirely and left an endpoint
  // that sends an agent's USDC to any address completely open — fail-open
  // on the one route where the cost of being wrong is the funds. And it
  // accepted a single platform-wide secret to move ANY agent's money,
  // which is exactly the shared-service-account model lib/agent-keys.ts
  // was written to end; the callback path moved to per-agent keys and this
  // one was left behind.
  //
  // resolveCallbackAuth gives both: the agent's own key, with the shared
  // secret still tolerated for platform-runtime agents during the external
  // runtime's transition (and only for them).
  const { resolveCallbackAuth, callbackSecretMatches } = await import('@/lib/webhook')
  const auth = await resolveCallbackAuth(agentId)
  if (!auth.required) {
    return Response.json(
      { error: 'Wallet actions are unavailable: this agent has no key and no runtime secret is configured.' },
      { status: 503 },
    )
  }
  if (!callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { isAgentAccountConfigured } = await import('@/lib/onchain/config')
    if (!isAgentAccountConfigured()) {
      return Response.json({ error: 'On-chain wallet not configured' }, { status: 503 })
    }
    const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')

    if (action === 'balance') {
      const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
      const spent = await spentLast24h(agentId)
      const policy = await policyForAgent(agentId)
      return Response.json({
        address: ag.smartAccountAddress,
        usdc: balance,
        policy: { maxPerTx: policy.maxPerTxUsd, dailyCap: policy.dailyCapUsd, spent24h: spent },
      })
    }

    if (action === 'transfer') {
      const to = String(body?.to ?? '')
      const amountUsd = Number(body?.amount)
      const memo = String(body?.memo ?? '').slice(0, 200)
      if (!isValidAddress(to)) return Response.json({ error: 'Invalid recipient address' }, { status: 400 })

      await enforceSpendingPolicy(agentId, amountUsd)
      const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
      if (amountUsd > balance) {
        return Response.json({ error: `Insufficient balance ($${balance.toFixed(2)})` }, { status: 400 })
      }

      // A withdrawal that reports failure while the money actually left is
      // the one error a user WILL act on — by pressing withdraw again. So a
      // pending transfer is reported as pending, never as failed, and the
      // audit event is written either way: the funds may be gone, and an
      // unrecorded outgoing transfer is exactly what a ledger is for.
      let txHash: string
      let pending = false
      try {
        txHash = await transferUsdc(agentId, to, amountUsd)
      } catch (error) {
        const { isUserOpPending } = await import('@/lib/onchain/account')
        if (!isUserOpPending(error)) throw error
        pending = true
        txHash = error.userOpHash
      }

      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId,
        taskId: `wallet-${nanoid(8)}`,
        eventType: 'WALLET_TRANSFER',
        success: true,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: null,
        detail: { amountUsd, to, memo, txHash, initiator: 'agent', pending },
      })

      if (pending) {
        return Response.json(
          {
            status: 'pending',
            userOpHash: txHash,
            amountUsd,
            to,
            message:
              'The transfer was accepted but is not confirmed yet. Do NOT retry — check the balance in a minute; retrying could send it twice.',
          },
          { status: 202 },
        )
      }

      return Response.json({ txHash, amountUsd, to })
    }

    return Response.json({ error: `Unknown action ${action}` }, { status: 400 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
