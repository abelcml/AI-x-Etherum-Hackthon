/**
 * Shared transfer/sweep core used by BOTH the session-authed server actions
 * (app/actions/treasury.ts) and the password-re-authed headless wallet API
 * (app/api/wallet/withdraw). Lives here — not exported from the actions
 * file — because 'use server' exports become invokable action endpoints,
 * and this function deliberately performs no authorization of its own:
 * every caller must have already established the caller owns the agent.
 */
import { db } from '@/lib/db'
import { agentEvent } from '@/lib/db/schema'
import { nanoid } from 'nanoid'
import { policyForAgent, spentLast24h } from '@/lib/treasury-policy'

export type SweepResult = { agentId: string; name: string; sent: number; txHash?: string; error?: string }

/** Balance check → on-chain transfer → ledger event. No policy check here —
 *  sweepAgentToAddress caps the amount instead; direct sends must call
 *  enforceSpendingPolicy first. */
export async function doTransfer(
  agentId: string,
  smartAccountAddress: string,
  to: string,
  amountUsd: number,
  memo: string,
  initiator: 'owner' | 'agent' = 'owner',
) {
  const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')
  const balance = await usdcBalanceOf(smartAccountAddress as `0x${string}`)
  if (amountUsd > balance) throw new Error(`Insufficient balance ($${balance.toFixed(2)})`)

  // Every withdrawal path funnels through here, so this is where a lost
  // receipt would otherwise become a double withdrawal: the caller sees an
  // error, the user presses the button again, and the first transfer lands
  // too. Pending is recorded and reported, never thrown.
  let txHash: string
  let pending = false
  try {
    txHash = await transferUsdc(agentId, to as `0x${string}`, amountUsd)
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
    detail: { amountUsd, to, memo, txHash, initiator, pending },
  })

  return txHash
}

/** Sweep one agent's full balance (bounded by its remaining per-tx/24h
 *  caps) to `to`. Returns null when the balance is zero — nothing to
 *  report. Keeping every withdrawal path on this one function is what
 *  stops cap semantics drifting between the dashboard button, the
 *  per-agent button, and the desktop app. */
export async function sweepAgentToAddress(
  ag: { id: string; name: string; smartAccountAddress: string | null },
  to: string,
  memo: string,
): Promise<SweepResult | null> {
  if (!ag.smartAccountAddress) return { agentId: ag.id, name: ag.name, sent: 0, error: 'No smart account provisioned' }
  try {
    const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
    const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
    if (balance <= 0) return null

    const policy = await policyForAgent(ag.id)
    const spent = await spentLast24h(ag.id)
    // NaN from a malformed env/setting would silently pass every numeric
    // guard below — fail loudly per-agent instead.
    if (!Number.isFinite(policy.maxPerTxUsd) || !Number.isFinite(policy.dailyCapUsd) || !Number.isFinite(spent)) {
      return { agentId: ag.id, name: ag.name, sent: 0, error: 'Spending cap misconfigured' }
    }
    const remainingCap = Math.max(0, Math.min(policy.maxPerTxUsd, policy.dailyCapUsd - spent))
    const amount = Math.min(balance, remainingCap)
    if (amount <= 0) {
      return {
        agentId: ag.id,
        name: ag.name,
        sent: 0,
        error: `Daily transfer cap reached ($${policy.dailyCapUsd}/24h — raise it in payout settings)`,
      }
    }

    // The bundler/paymaster RPC (ZeroDev free tier) rate-limits aggressively;
    // a multi-agent sweep fires transfers back-to-back and trips it. Retry
    // 429s with a short backoff instead of failing the agent outright —
    // kept tight (2 retries) to stay inside the serverless time budget.
    let txHash: string | undefined
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        txHash = await doTransfer(ag.id, ag.smartAccountAddress, to, amount, memo)
        break
      } catch (error) {
        lastError = error
        const msg = error instanceof Error ? error.message : String(error)
        const rateLimited = msg.includes('429') || msg.toLowerCase().includes('rate limit')
        if (!rateLimited || attempt === 2) throw error
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)))
      }
    }
    if (!txHash) throw lastError
    const capped = amount < balance
    return {
      agentId: ag.id,
      name: ag.name,
      sent: amount,
      txHash,
      ...(capped ? { error: `Only $${amount.toFixed(2)} of $${balance.toFixed(2)} sent (cap) — rest after the 24h window or a higher cap` } : {}),
    }
  } catch (error) {
    return { agentId: ag.id, name: ag.name, sent: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
