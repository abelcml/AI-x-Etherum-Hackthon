/**
 * Small retry helper for transient failures — LLM provider overloads
 * (overloaded_error / 429 / 529), brief 5xx, and network blips. Exponential
 * backoff with jitter. Used to wrap grading/verification provider calls so a
 * momentary Anthropic/Groq overload doesn't strand a job in Submitted forever.
 */
export function isTransientLlmError(e: unknown): boolean {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) return true
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return /overloaded|rate.?limit|too many requests|\b429\b|\b503\b|\b529\b|timeout|timed out|econnreset|etimedout|socket hang up|fetch failed|network/.test(
    m,
  )
}

export interface RetryOpts {
  retries?: number
  baseMs?: number
  retryable?: (e: unknown) => boolean
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const retries = opts.retries ?? 3
  const base = opts.baseMs ?? 800
  const retryable = opts.retryable ?? isTransientLlmError
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (attempt === retries || !retryable(e)) throw e
      const wait = base * 2 ** attempt + Math.floor(base * Math.random())
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw last
}
