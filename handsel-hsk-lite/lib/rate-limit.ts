/**
 * Best-effort in-memory sliding-window rate limiter, keyed per (bucket, id)
 * — one Map per warm serverless instance. Not a distributed limiter: a
 * burst spread across cold instances can exceed the nominal rate, which is
 * fine for the abuse it guards (credential stuffing, agent-spam, token
 * minting) — the durable DB caps (per-account agent limit, hourly new-user
 * cap) are the hard backstop; this just makes the cheap path expensive
 * enough to deter scripted abuse.
 */

const buckets = new Map<string, Map<string, number[]>>()

export interface RateLimitOpts {
  /** Distinct namespace so unrelated limiters don't share counters. */
  bucket: string
  /** Window length in ms. */
  windowMs: number
  /** Max events allowed within the window. */
  max: number
}

/** Returns true when the caller is OVER the limit (should be rejected).
 *  Records the attempt when allowed. */
export function rateLimited(id: string, opts: RateLimitOpts): boolean {
  const now = Date.now()
  let bucket = buckets.get(opts.bucket)
  if (!bucket) {
    bucket = new Map()
    buckets.set(opts.bucket, bucket)
  }
  const hits = (bucket.get(id) ?? []).filter((t) => now - t < opts.windowMs)
  if (hits.length >= opts.max) {
    bucket.set(id, hits) // persist the pruned list; don't add another hit
    return true
  }
  hits.push(now)
  bucket.set(id, hits)
  return false
}

/** Best-effort client IP from proxy headers. 'unknown' when absent — all
 *  such callers share one bucket, which is acceptable (fail toward
 *  limiting rather than bypassing). */
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
