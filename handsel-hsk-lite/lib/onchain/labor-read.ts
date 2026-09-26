/**
 * "The market is empty" and "I could not see the market" are different facts,
 * and `readJobs().catch(() => [])` collapses them into the same empty array.
 *
 * For a page that just renders a list, that collapse is harmless — a visitor
 * sees nothing for a moment. For anything that SPENDS on absence it inverts
 * the decision: every restock, faucet refill and idempotency check reads
 * "zero Open jobs" and concludes the board has drained, when what actually
 * happened is that an RPC call timed out. A transient Sepolia hiccup then
 * mints escrowed jobs that nobody asked for — and the sweeps most likely to
 * hit that are the ones on the five-minute traffic tick, so an outage bills
 * repeatedly for as long as it lasts.
 *
 * This is invariant #5 from docs/failure-modes.md ("never act on missing
 * evidence") with a type behind it: `null` means unknown, `[]` means empty,
 * and a caller that spends must handle `null` by doing nothing.
 */
import type { OnchainJob } from '@/lib/onchain/labor'

/** Unknown (`null`) is never silently coerced to empty. */
export type MaybeJobs = OnchainJob[] | null

/**
 * The pure core, so the distinction is testable without a chain: any read
 * that throws becomes `null`, and only a genuine success can produce `[]`.
 */
export async function readOrUnknown<T>(read: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    console.warn(`[chain] ${label} read failed — treating market state as UNKNOWN, not empty:`, error)
    return null
  }
}

/** `readJobs` that admits it failed. Use anywhere absence authorizes a spend. */
export async function readJobsOrUnknown(opts?: { maxAgeMs?: number }): Promise<MaybeJobs> {
  const { readJobs } = await import('@/lib/onchain/labor')
  return readOrUnknown(() => readJobs(opts), 'readJobs')
}

/** How many of the market's Open jobs a given requester owns — `null` when
 *  the chain could not be read, so callers cannot mistake it for zero. */
export function countOpenBy(jobs: MaybeJobs, requesterAddress?: string): number | null {
  if (jobs === null) return null
  const open = jobs.filter((j) => j.status === 'Open')
  if (!requesterAddress) return open.length
  const want = requesterAddress.toLowerCase()
  return open.filter((j) => j.requester.toLowerCase() === want).length
}
