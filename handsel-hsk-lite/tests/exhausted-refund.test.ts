import { describe, it, expect } from 'vitest'
import { shouldRefundExhausted, reviewWindowMs, type ExhaustedCandidate } from '@/lib/exhausted-refund'
import { MAX_AUTO_REPOSTS } from '@/lib/labor-settle'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-07-26T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR).toISOString()
const win = 24 * HOUR

const spec = (over: Partial<ExhaustedCandidate> = {}): ExhaustedCandidate => ({
  repostCount: MAX_AUTO_REPOSTS,
  testResult: { passed: false, gradedAt: hoursAgo(48) },
  repoFullName: null,
  ...over,
})

// "Leaving for manual review" was limbo, not a queue: escrow held forever
// for a reviewer who, on house-posted work, does not exist.

describe('shouldRefundExhausted', () => {
  it('refunds a cap-exhausted graded failure past the review window', () => {
    expect(shouldRefundExhausted(now, spec(), win)).toBe(true)
  })

  it('waits out the review window first', () => {
    expect(shouldRefundExhausted(now, spec({ testResult: { passed: false, gradedAt: hoursAgo(2) } }), win)).toBe(false)
  })

  it('leaves jobs that still have retries left to the repost path', () => {
    expect(shouldRefundExhausted(now, spec({ repostCount: MAX_AUTO_REPOSTS - 1 }), win)).toBe(false)
  })

  it('never touches a passing or ungraded job', () => {
    expect(shouldRefundExhausted(now, spec({ testResult: { passed: true, gradedAt: hoursAgo(48) } }), win)).toBe(false)
    expect(shouldRefundExhausted(now, spec({ testResult: { passed: null, gradedAt: hoursAgo(48) } }), win)).toBe(false)
    expect(shouldRefundExhausted(now, spec({ testResult: null }), win)).toBe(false)
  })

  it('exempts repo jobs — merge is their trigger and closing the PR already refunds', () => {
    expect(shouldRefundExhausted(now, spec({ repoFullName: 'acme/widgets' }), win)).toBe(false)
  })

  it('treats an unparseable verdict time as not-yet, never acting on missing evidence', () => {
    expect(shouldRefundExhausted(now, spec({ testResult: { passed: false, gradedAt: 'whenever' } }), win)).toBe(false)
  })
})

describe('reviewWindowMs', () => {
  it('defaults to 24h and ignores nonsense', () => {
    const original = process.env.EXHAUSTED_REVIEW_HOURS
    delete process.env.EXHAUSTED_REVIEW_HOURS
    expect(reviewWindowMs()).toBe(24 * HOUR)
    process.env.EXHAUSTED_REVIEW_HOURS = 'tomorrow'
    expect(reviewWindowMs()).toBe(24 * HOUR)
    process.env.EXHAUSTED_REVIEW_HOURS = '1'
    expect(reviewWindowMs()).toBe(HOUR)
    if (original === undefined) delete process.env.EXHAUSTED_REVIEW_HOURS
    else process.env.EXHAUSTED_REVIEW_HOURS = original
  })
})
