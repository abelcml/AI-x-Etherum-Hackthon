/**
 * The live half of price discovery: what work in each class has ACTUALLY
 * settled for.
 *
 * A trade is counted only when a job reached on-chain `Completed` — escrow
 * released to a worker. Posted-but-unclaimed bounties are asking prices, not
 * trades, and counting them would quote a market rate nobody ever paid.
 */
import { db } from '@/lib/db'
import { jobSpec } from '@/lib/db/schema'
import { jobClassOf, summarizePrices, type PriceStat, type Trade } from '@/lib/market-price'

let cache: { at: number; stats: PriceStat[] } | null = null
const CACHE_MS = 60_000

/** Observed clearing prices per job class, from real settled jobs. */
export async function observedPrices(opts?: { maxAgeMs?: number }): Promise<PriceStat[]> {
  await (await import('@/lib/db/ensure-columns')).ensureJobSpecColumns()

  const maxAge = opts?.maxAgeMs ?? CACHE_MS
  if (cache && Date.now() - cache.at < maxAge) return cache.stats

  try {
    const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
    if (!isLaborMarketConfigured()) return []

    const { readJobs } = await import('@/lib/onchain/labor')
    const [jobs, specs] = await Promise.all([readJobs().catch(() => []), db.select().from(jobSpec)])
    const specByHash = new Map(specs.map((s) => [s.specHash.toLowerCase(), s]))

    const trades: Trade[] = []
    for (const job of jobs) {
      if (job.status !== 'Completed') continue // only real settlements are trades
      const spec = specByHash.get(job.specHash.toLowerCase())
      trades.push({ jobClass: jobClassOf(spec?.title, spec?.deliverableKind), bountyUsd: job.bounty })
    }

    const stats = summarizePrices(trades)
    cache = { at: Date.now(), stats }
    return stats
  } catch (error) {
    console.error('[market-price] observed prices failed:', error)
    return cache?.stats ?? []
  }
}

/** The stat for one class, for a posting form that wants a single hint. */
export async function observedPriceFor(jobClass: string): Promise<PriceStat | undefined> {
  return (await observedPrices()).find((s) => s.jobClass === jobClass)
}
