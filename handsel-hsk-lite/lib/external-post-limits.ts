/**
 * Paid is not the same as authorized.
 *
 * `POST /api/jobs/external` is behind an x402 paywall, and the paywall was
 * doing double duty in my head: it charges $0.10, so surely nobody spams it.
 * But the endpoint's whole point is that $0.10 buys a **$25 house-escrowed
 * bounty**, which makes the economics inverted — paying more is exactly what
 * an abuser wants to do. A price is a price. It is not a rate limit.
 *
 * On testnet the escrowed mUSDC is free to mint, so the loss isn't the
 * headline. What a few dollars of spend actually buys is:
 *
 *  - a sponsored UserOperation per post, against a real paymaster budget;
 *  - a house wallet drained to zero, so the *legitimate* dogfood postings
 *    that share it start failing with `USDC: balance`;
 *  - a board of junk that real workers have to dig through, which is the one
 *    asset a labor market can't rebuild quickly.
 *
 * Two buckets, because they fail differently: a per-payer cap keeps one
 * client from monopolising the board, and a global cap keeps the house
 * solvent no matter how many payers show up. Both reset on the UTC day, the
 * same boundary the faucet's daily cap already uses.
 *
 * Pure so the arithmetic is pinned down; the counting lives at the call site.
 */

export const EXTERNAL_POST_PER_PAYER_PER_DAY = 5
export const EXTERNAL_POST_GLOBAL_PER_DAY = 40

/**
 * Payments whose payer we could not read from the x402 header all share one
 * bucket. That is deliberately strict: an unattributable post is exactly the
 * one we can least afford to hand an individual allowance to.
 */
export const UNATTRIBUTED_PAYER = 'unattributed'

export type PostAllowance = { ok: true } | { ok: false; reason: string; scope: 'payer' | 'global' }

export function externalPostAllowed(counts: { payerToday: number; globalToday: number }): PostAllowance {
  if (counts.globalToday >= EXTERNAL_POST_GLOBAL_PER_DAY) {
    return {
      ok: false,
      scope: 'global',
      reason: `The market has taken its daily maximum of ${EXTERNAL_POST_GLOBAL_PER_DAY} externally-posted jobs. Try again after 00:00 UTC.`,
    }
  }
  if (counts.payerToday >= EXTERNAL_POST_PER_PAYER_PER_DAY) {
    return {
      ok: false,
      scope: 'payer',
      reason: `This payer has posted ${counts.payerToday} jobs today (limit ${EXTERNAL_POST_PER_PAYER_PER_DAY}). Try again after 00:00 UTC.`,
    }
  }
  return { ok: true }
}

/** Start of the current UTC day — the reset boundary for both buckets. */
export function utcDayStart(now = new Date()): Date {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d
}
