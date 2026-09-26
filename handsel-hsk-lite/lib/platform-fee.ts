/**
 * Posting fee — the classic exchange defense against wash trading, applied
 * to a labor market.
 *
 * The halving schedule caps how much REPUTATION a ring can farm; it cannot
 * make farming COST anything, because moving your own testnet dollars from
 * pocket A to pocket B is free. A fee on every posting changes that: the
 * cost of manufacturing a track record becomes proportional to the volume
 * manufactured, paid to the house. Honest requesters pay it once per real
 * job; a wash-trading ring pays it on every fake one.
 *
 * Shape rules:
 * - Charged at the human/bot entry points (UI post, MCP post, label bot) —
 *   never on refund-reposts or automatic price raises, which would bill the
 *   same intent twice.
 * - The house's own postings (faucet, dogfood) are exempt: the house paying
 *   itself is bookkeeping noise, not revenue.
 * - Degrades gracefully (CLAUDE.md rule): no house agent configured → no
 *   fee, posting proceeds. But when a fee IS due and the transfer fails,
 *   the posting aborts — a fee that only sometimes collects is a fee only
 *   honest users pay.
 * - The transfer is a real on-chain USDC transfer, visible like any other.
 */
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const DEFAULT_FEE_BPS = 200 // 2%

/** Fee rate in basis points from PLATFORM_FEE_BPS; clamped to [0, 2000]. */
export function platformFeeBps(): number {
  const raw = process.env.PLATFORM_FEE_BPS
  if (raw === undefined || raw.trim() === '') return DEFAULT_FEE_BPS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FEE_BPS
  return Math.min(2000, Math.floor(n))
}

/** Fee for a bounty, rounded to cents, with a 1-cent floor while enabled —
 *  a fee that rounds to zero on small jobs would make micro-postings the
 *  free farming lane. Pure, so the schedule is unit-testable. */
export function feeForBounty(bountyUsd: number, bps: number = platformFeeBps()): number {
  if (bps <= 0 || !Number.isFinite(bountyUsd) || bountyUsd <= 0) return 0
  return Math.max(0.01, Math.round((bountyUsd * bps) / 100) / 100)
}

export type FeeResult =
  | { feeUsd: number; txHash: string }
  | { feeUsd: 0; skipped: string }

/**
 * Collect the posting fee from the requester into the house wallet.
 * Returns what happened; THROWS only when a due fee fails to transfer
 * (insufficient balance is the honest, informative failure: the requester
 * cannot afford bounty + fee).
 */
export async function collectPostingFee(requesterAgentId: string, bountyUsd: number, ref: string): Promise<FeeResult> {
  const bps = platformFeeBps()
  if (bps <= 0) return { feeUsd: 0, skipped: 'fee disabled (PLATFORM_FEE_BPS=0)' }

  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID
  if (!houseAgentId) return { feeUsd: 0, skipped: 'no house agent configured' }
  if (requesterAgentId === houseAgentId) return { feeUsd: 0, skipped: 'house postings are exempt' }

  const [house] = await db
    .select({ address: agent.smartAccountAddress })
    .from(agent)
    .where(eq(agent.id, houseAgentId))
  if (!house?.address) return { feeUsd: 0, skipped: 'house agent has no wallet' }

  const feeUsd = feeForBounty(bountyUsd, bps)
  if (feeUsd <= 0) return { feeUsd: 0, skipped: 'zero fee for this bounty' }

  const [requester] = await db
    .select({ address: agent.smartAccountAddress })
    .from(agent)
    .where(eq(agent.id, requesterAgentId))
  if (!requester?.address) return { feeUsd: 0, skipped: 'requester has no wallet' }

  // Affordability BEFORE any money moves. The fee is charged first and the
  // escrow locks second, so a requester holding exactly the bounty would
  // otherwise pay the fee and then watch the escrow revert with
  // `USDC: balance` — fee gone, no job, no refund path. Checking the total
  // up front turns that into one clear sentence and zero lost funds.
  const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')
  const balanceUsd = await usdcBalanceOf(requester.address as `0x${string}`).catch(() => null)
  // An unreadable balance is not an affordable one. Skipping the check on
  // `null` meant an RPC hiccup charged the fee blind — and then the escrow
  // reverts on `USDC: balance` and the fee is gone with no job and no refund,
  // which is the exact outcome this check exists to prevent. Waive the fee
  // instead: losing the platform's cut is strictly better than taking a
  // requester's money for nothing, and the escrow still fails cleanly on its
  // own if the wallet really is short.
  if (balanceUsd === null) {
    return { feeUsd: 0, skipped: 'could not read the requester balance — fee waived rather than charged blind' }
  }
  if (balanceUsd < bountyUsd + feeUsd) {
    throw new Error(
      `Not enough test USDC: posting a $${bountyUsd} bounty costs $${(bountyUsd + feeUsd).toFixed(2)} ` +
        `($${bountyUsd} escrowed + $${feeUsd.toFixed(2)} posting fee), and this agent holds $${balanceUsd.toFixed(2)}. ` +
        `Mint more on the agent's page, then try again.`,
    )
  }

  const txHash = await transferUsdc(requesterAgentId, house.address as `0x${string}`, feeUsd)

  const { logPlatformEvent } = await import('@/lib/platform-feed')
  await logPlatformEvent('PLATFORM_FEE', `$${feeUsd.toFixed(2)} posting fee (${bps} bps) collected on ${ref}`).catch(() => {})

  return { feeUsd, txHash }
}
