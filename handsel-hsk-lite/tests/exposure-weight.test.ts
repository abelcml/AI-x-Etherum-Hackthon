import { describe, expect, it } from 'vitest'
import {
  EXPOSURE_MAX_NEGATIVE,
  EXPOSURE_MAX_POSITIVE,
  EXPOSURE_MIN_NEGATIVE,
  EXPOSURE_MIN_POSITIVE,
  EXPOSURE_REFERENCE_USD,
  exposureWeight,
  isNegativeSignal,
  weightedMarketSignal,
  type AgentEventInput,
} from '@/lib/credit-engine/scoring'

/**
 * Until this weight existed, delivering a $200 contract and fixing a $1 typo
 * were the same evidence. Every real credit system disagrees: the amount at
 * stake is information about how much a counterparty trusted you, and about
 * how much was destroyed when you failed.
 */
describe('exposureWeight', () => {
  it('is neutral at the reference bounty, so existing histories are not re-scored', () => {
    expect(exposureWeight(EXPOSURE_REFERENCE_USD)).toBe(1)
  })

  it('is neutral when the bounty is unknown — no retroactive penalty', () => {
    // Same convention as counterparty/counterpartyScore: legacy rows keep
    // full weight rather than being punished for missing data.
    for (const v of [null, undefined, 0, -5, NaN, Infinity]) {
      expect(exposureWeight(v as number | null | undefined)).toBe(1)
    }
  })

  it('rewards larger exposure, sublinearly', () => {
    const w25 = exposureWeight(25)
    expect(w25).toBeGreaterThan(1)
    // A 2.5x bounty must not be worth 2.5x the reputation.
    expect(w25).toBeLessThan(2.5)
  })

  it('caps hard, so bounty inflation stops paying', () => {
    // Testnet escrow is freely mintable; the weight has to stop caring long
    // before the numbers get silly.
    expect(exposureWeight(100)).toBe(EXPOSURE_MAX_POSITIVE)
    expect(exposureWeight(1_000)).toBe(EXPOSURE_MAX_POSITIVE)
    expect(exposureWeight(10_000_000)).toBe(EXPOSURE_MAX_POSITIVE)
  })

  it('floors, so trivial jobs are discounted but not erased', () => {
    expect(exposureWeight(1)).toBe(EXPOSURE_MIN_POSITIVE)
    expect(exposureWeight(0.01)).toBe(EXPOSURE_MIN_POSITIVE)
  })

  it('is monotonic across the live range', () => {
    const xs = [1, 5, 10, 25, 50, 100, 200]
    const ws = xs.map((x) => exposureWeight(x))
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeGreaterThanOrEqual(ws[i - 1]!)
  })

  describe('asymmetry: failure weighs more than success', () => {
    it('a failure on a big job outweighs a success on the same job', () => {
      expect(exposureWeight(200, { negative: true })).toBeGreaterThan(exposureWeight(200))
      expect(exposureWeight(200, { negative: true })).toBe(EXPOSURE_MAX_NEGATIVE)
    })

    it('a failure on a cheap job cannot be shrugged off like a cheap success', () => {
      expect(exposureWeight(1, { negative: true })).toBe(EXPOSURE_MIN_NEGATIVE)
      expect(EXPOSURE_MIN_NEGATIVE).toBeGreaterThan(EXPOSURE_MIN_POSITIVE)
    })

    it('matches the asymmetry this file already encodes for decay', () => {
      // NEGATIVE_HALF_LIFE_DAYS > REPUTATION_HALF_LIFE_DAYS: bad news lingers.
      expect(EXPOSURE_MAX_NEGATIVE).toBeGreaterThan(EXPOSURE_MAX_POSITIVE)
    })
  })
})

describe('isNegativeSignal', () => {
  it('classifies failures, so a caller cannot wire the asymmetry backwards', () => {
    expect(isNegativeSignal('JOB_TESTS_FAILED')).toBe(true)
    expect(isNegativeSignal('VERIFIED_TASK_FAILED')).toBe(true)
    expect(isNegativeSignal('REPAYMENT_DEFAULTED')).toBe(true)
    expect(isNegativeSignal('JOB_COMPLETED')).toBe(false)
    expect(isNegativeSignal('JOB_TESTS_PASSED')).toBe(false)
  })
})

describe('weightedMarketSignal with exposure', () => {
  const ev = (over: Partial<AgentEventInput>): AgentEventInput => ({
    eventType: 'JOB_COMPLETED',
    success: true,
    executionTime: 1,
    tokenCost: 0,
    qualityScore: 1,
    createdAt: new Date('2026-07-27T00:00:00Z'),
    counterparty: null,
    grader: 'tests',
    counterpartyScore: null,
    exposureUsd: null,
    ...over,
  })
  const now = new Date('2026-07-27T00:00:00Z')

  it('a $200 completion outweighs a $1 completion', () => {
    const big = weightedMarketSignal([ev({ exposureUsd: 200 })], 'JOB_COMPLETED', now)
    const small = weightedMarketSignal([ev({ exposureUsd: 1 })], 'JOB_COMPLETED', now)
    expect(big).toBeGreaterThan(small)
    // …but by the capped ratio, not by 200x.
    expect(big / small).toBeCloseTo(EXPOSURE_MAX_POSITIVE / EXPOSURE_MIN_POSITIVE, 5)
  })

  it('leaves a history with no bounty data exactly where it was', () => {
    // The regression that matters: nobody's score moves because of this
    // change unless their events actually carry a bounty.
    const withNull = weightedMarketSignal([ev({}), ev({})], 'JOB_COMPLETED', now)
    const atReference = weightedMarketSignal(
      [ev({ exposureUsd: EXPOSURE_REFERENCE_USD }), ev({ exposureUsd: EXPOSURE_REFERENCE_USD })],
      'JOB_COMPLETED',
      now,
    )
    expect(withNull).toBeCloseTo(atReference, 10)
  })

  it('still composes with the collusion halving rather than defeating it', () => {
    // A ring cannot buy its way out of the diversity discount by inflating
    // bounties: the second trade with the same partner is halved regardless.
    const same = (usd: number) => [
      ev({ counterparty: 'req-1', exposureUsd: usd }),
      ev({ counterparty: 'req-1', exposureUsd: usd, createdAt: new Date('2026-07-27T01:00:00Z') }),
    ]
    const total = weightedMarketSignal(same(200), 'JOB_COMPLETED', now)
    const first = weightedMarketSignal([same(200)[0]!], 'JOB_COMPLETED', now)
    expect(total).toBeCloseTo(first * 1.5, 5) // 1 + 0.5, halving intact
  })
})
