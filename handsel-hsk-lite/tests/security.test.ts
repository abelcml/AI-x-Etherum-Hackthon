import { describe, expect, it } from 'vitest'
import { rateLimited } from '@/lib/rate-limit'
import { throttleIp } from '@/lib/auth-throttle'
import { faucetReservedFor, FAUCET_GRACE_MS, NEW_MINER_MAX_SCORE } from '@/lib/job-faucet'

describe('rateLimited', () => {
  it('allows up to max then blocks within the window', () => {
    const id = `u-${Math.random()}`
    const opts = { bucket: 'test', windowMs: 60_000, max: 3 }
    expect(rateLimited(id, opts)).toBe(false) // 1
    expect(rateLimited(id, opts)).toBe(false) // 2
    expect(rateLimited(id, opts)).toBe(false) // 3
    expect(rateLimited(id, opts)).toBe(true) // 4 — over
    expect(rateLimited(id, opts)).toBe(true) // stays blocked
  })

  it('isolates ids and buckets', () => {
    const opts = { bucket: 'iso', windowMs: 60_000, max: 1 }
    expect(rateLimited('a', opts)).toBe(false)
    expect(rateLimited('a', opts)).toBe(true)
    expect(rateLimited('b', opts)).toBe(false) // different id, fresh
    expect(rateLimited('a', { bucket: 'iso2', windowMs: 60_000, max: 1 })).toBe(false) // different bucket
  })
})

describe('throttleIp', () => {
  const req = (h: Record<string, string>) => new Request('https://x.test', { headers: h })
  it('takes the first x-forwarded-for hop', () => {
    expect(throttleIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
    expect(throttleIp(req({ 'x-forwarded-for': '  9.9.9.9  ' }))).toBe('9.9.9.9')
  })
  it('falls back to a shared bucket when the header is absent', () => {
    expect(throttleIp(req({}))).toBe('unknown')
  })
})

describe('faucetReservedFor (new-miner priority)', () => {
  const now = 1_000_000_000

  it('reserves fresh faucet jobs from high-credit agents during the grace window', () => {
    const justPosted = new Date(now - 1000)
    expect(faucetReservedFor(NEW_MINER_MAX_SCORE + 100, justPosted, now)).toBe(true) // high credit → held back
    expect(faucetReservedFor(NEW_MINER_MAX_SCORE - 1, justPosted, now)).toBe(false) // new miner → allowed
  })

  it('lets anyone claim after the grace window elapses', () => {
    const old = new Date(now - FAUCET_GRACE_MS - 1)
    expect(faucetReservedFor(NEW_MINER_MAX_SCORE + 100, old, now)).toBe(false) // no longer reserved
  })

  it('never reserves when the post time is unknown', () => {
    expect(faucetReservedFor(9999, null, now)).toBe(false)
  })
})
