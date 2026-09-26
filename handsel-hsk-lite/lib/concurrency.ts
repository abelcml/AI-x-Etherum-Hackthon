/**
 * Bounded-parallel helpers.
 *
 * The whole mining/settlement layer historically ran serially — every
 * cross-agent sweep was a `for … of` with `await` inside, so N agents were
 * processed one after another (see docs/parallel-mining.md). `mapLimit` is
 * the primitive that lets those sweeps fan out across agents while keeping a
 * ceiling on how many run at once (free-tier RPC / bundler rate limits make
 * unbounded `Promise.all` a real hazard).
 *
 * Result order matches input order regardless of completion order, so callers
 * can zip results back to their inputs by index.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length
  const results = new Array<R>(n)
  if (n === 0) return results
  const cap = Math.max(1, Math.min(Math.floor(limit) || 1, n))

  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= n) return
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()))
  return results
}
