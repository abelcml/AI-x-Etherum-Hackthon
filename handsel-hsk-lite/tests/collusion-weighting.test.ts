/**
 * Collusion-resistant scoring, halving edition.
 *
 * The design borrows Bitcoin's halving insight: make every reward schedule a
 * CONVERGENT series and total extractable value is capped by construction.
 * Four multiplicative weights, four attacks:
 *
 *   diversity (1/2^k)      — wash-trading with ONE partner: capped at 2 trades' worth, forever
 *   credibility (by score)  — minting FRESH partner accounts: each contributes the floor
 *   grader strength         — authoring your own passable criteria: LLM review counts least
 *   recency (half-life)     — farm-once-coast-forever and bought aged accounts: reputation decays
 */
import { describe, expect, it } from 'vitest'
import {
  CREDIBILITY_FLOOR,
  NEGATIVE_HALF_LIFE_DAYS,
  REPUTATION_HALF_LIFE_DAYS,
  assessCredit,
  collusionWeight,
  credibilityWeight,
  graderWeight,
  recencyWeight,
  weightedMarketSignal,
  type AgentEventInput,
} from '@/lib/credit-engine/scoring'

const base = (over: Partial<AgentEventInput>): AgentEventInput => ({
  eventType: 'JOB_TESTS_PASSED',
  success: true,
  executionTime: 1,
  tokenCost: 0,
  qualityScore: 1,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
})

const at = (i: number) => new Date(Date.UTC(2026, 6, 1, i)) // strictly increasing hours
const NOW = at(100) // fixed clock: these tests are about weights, not wall time

describe('collusionWeight — the halving schedule', () => {
  it('halves per repeat: 1, 1/2, 1/4, …', () => {
    expect(collusionWeight(0)).toBe(1)
    expect(collusionWeight(1)).toBe(0.5)
    expect(collusionWeight(3)).toBe(0.125)
  })

  it('CONVERGES: infinite trades with one partner are worth at most 2 full-weight trades', () => {
    let total = 0
    for (let k = 0; k < 1000; k++) total += collusionWeight(k)
    // Float addition saturates at exactly 2.0 — the bound is the point.
    expect(total).toBeLessThanOrEqual(2)
    expect(total).toBeGreaterThan(1.999)
  })
})

describe('credibilityWeight — fresh accomplices earn the floor', () => {
  it('a freshly minted score-300 counterparty contributes the floor weight', () => {
    expect(credibilityWeight(300)).toBe(CREDIBILITY_FLOOR)
  })
  it('an established counterparty contributes full weight from score 700', () => {
    expect(credibilityWeight(700)).toBe(1)
    expect(credibilityWeight(990)).toBe(1)
  })
  it('scales between, and legacy events without a stamp keep full weight', () => {
    expect(credibilityWeight(500)).toBeCloseTo(CREDIBILITY_FLOOR + (1 - CREDIBILITY_FLOOR) * 0.5, 10)
    expect(credibilityWeight(null)).toBe(1)
    expect(credibilityWeight(undefined)).toBe(1)
  })
})

describe('recencyWeight — reputation is a flow, not a stock', () => {
  const t0 = new Date('2026-01-01T00:00:00Z')
  const days = (d: number) => new Date(t0.getTime() + d * 24 * 60 * 60 * 1000)

  it('halves every half-life', () => {
    expect(recencyWeight(t0, days(REPUTATION_HALF_LIFE_DAYS))).toBeCloseTo(0.5, 10)
    expect(recencyWeight(t0, days(2 * REPUTATION_HALF_LIFE_DAYS))).toBeCloseTo(0.25, 10)
    expect(recencyWeight(t0, t0)).toBe(1)
  })

  it('bad news decays slower than good — the credit-reporting asymmetry', () => {
    expect(NEGATIVE_HALF_LIFE_DAYS).toBeGreaterThan(REPUTATION_HALF_LIFE_DAYS)
    const age = days(REPUTATION_HALF_LIFE_DAYS)
    expect(recencyWeight(t0, age, NEGATIVE_HALF_LIFE_DAYS)).toBeGreaterThan(
      recencyWeight(t0, age, REPUTATION_HALF_LIFE_DAYS),
    )
  })

  it('never rewards events from the future', () => {
    expect(recencyWeight(days(10), t0)).toBe(1)
  })
})

describe('graderWeight', () => {
  it("ranks graders by how hard a colluding pair can game them, buyer's CI on top", () => {
    expect(graderWeight('repo-ci')).toBeGreaterThan(graderWeight('tests'))
    expect(graderWeight('tests')).toBeGreaterThan(graderWeight('vision'))
    expect(graderWeight('vision')).toBeGreaterThan(graderWeight('llm-review'))
  })
  it('gives unknown/legacy graders the middle weight, never the top', () => {
    expect(graderWeight(null)).toBeLessThan(graderWeight('repo-ci'))
    expect(graderWeight(undefined)).toBe(graderWeight('some-future-grader'))
  })
})

describe('weightedMarketSignal — the attacks, priced', () => {
  it('a wash-trading ring with ONE partner is capped near 2 trades of value no matter the volume', () => {
    const ring = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        base({ counterparty: 'accomplice', counterpartyScore: 300, grader: 'llm-review', createdAt: at(i) }),
      )
    const w20 = weightedMarketSignal(ring(20), 'JOB_TESTS_PASSED', NOW)
    const w100 = weightedMarketSignal(ring(100), 'JOB_TESTS_PASSED', NOW)
    // cap = 2 (halving) × 0.25 (fresh account) × 0.6 (LLM) ≈ 0.3
    expect(w100).toBeLessThan(0.31)
    // and the 80 extra trades bought almost nothing:
    expect(w100 - w20).toBeLessThan(1e-4)
  })

  it('minting fresh counterparties fakes diversity but earns only the credibility floor', () => {
    const minted = Array.from({ length: 10 }, (_, i) =>
      base({ counterparty: `sock-${i}`, counterpartyScore: 300, grader: 'llm-review', createdAt: at(i) }),
    )
    const real = Array.from({ length: 10 }, (_, i) =>
      base({ counterparty: `client-${i}`, counterpartyScore: 750, grader: 'llm-review', createdAt: at(i) }),
    )
    const mintedScore = weightedMarketSignal(minted, 'JOB_TESTS_PASSED', NOW)
    const realScore = weightedMarketSignal(real, 'JOB_TESTS_PASSED', NOW)
    expect(mintedScore).toBeCloseTo(realScore * CREDIBILITY_FLOOR, 5)
  })

  it('CI-graded work from real clients is the gold standard', () => {
    const gold = Array.from({ length: 5 }, (_, i) =>
      base({ counterparty: `c${i}`, counterpartyScore: 800, grader: 'repo-ci', createdAt: at(i) }),
    )
    const washy = Array.from({ length: 5 }, (_, i) =>
      base({ counterparty: 'pal', counterpartyScore: 300, grader: 'llm-review', createdAt: at(i) }),
    )
    expect(weightedMarketSignal(gold, 'JOB_TESTS_PASSED', NOW)).toBeGreaterThan(
      10 * weightedMarketSignal(washy, 'JOB_TESTS_PASSED', NOW),
    )
  })

  it('legacy events (no stamps at all) keep the sane middle weight — no retroactive penalty', () => {
    const legacy = Array.from({ length: 4 }, (_, i) => base({ createdAt: at(i) }))
    // Evaluate at the time of the newest event so only the (negligible)
    // hours-scale recency decay applies — the point under test is the
    // diversity/credibility/grader weights all staying neutral.
    expect(weightedMarketSignal(legacy, 'JOB_TESTS_PASSED', at(3))).toBeCloseTo(4 * 0.8, 2)
  })

  it('is order-independent w.r.t. input array order', () => {
    const events = [
      base({ counterparty: 'x', grader: 'code', createdAt: at(2) }),
      base({ counterparty: 'x', grader: 'code', createdAt: at(0) }),
      base({ counterparty: 'x', grader: 'code', createdAt: at(1) }),
    ]
    const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    expect(weightedMarketSignal(events, 'JOB_TESTS_PASSED', NOW)).toBeCloseTo(
      weightedMarketSignal(sorted, 'JOB_TESTS_PASSED', NOW),
      10,
    )
  })

  it('old glory fades: identical events a year apart weigh very differently', () => {
    const fresh = base({ counterparty: 'c', counterpartyScore: 800, grader: 'code', createdAt: NOW })
    const stale = base({ counterparty: 'c2', counterpartyScore: 800, grader: 'code', createdAt: new Date(NOW.getTime() - 360 * 24 * 60 * 60 * 1000) })
    const wFresh = weightedMarketSignal([fresh], 'JOB_TESTS_PASSED', NOW)
    const wStale = weightedMarketSignal([stale], 'JOB_TESTS_PASSED', NOW)
    expect(wStale).toBeLessThan(wFresh * 0.3) // 360d at a 180d half-life → ×0.25
  })
})

describe('assessCredit end-to-end', () => {
  const terminal = (i: number): AgentEventInput =>
    base({ eventType: 'TASK_COMPLETED', qualityScore: 0.9, createdAt: at(i) })

  it('same volume, same graders — real diversity strictly outscores the ring', () => {
    const withMarket = (marketEvents: AgentEventInput[]) =>
      assessCredit([...Array.from({ length: 10 }, (_, i) => terminal(i)), ...marketEvents], undefined, NOW)
    const ring = withMarket(
      Array.from({ length: 12 }, (_, i) =>
        base({ eventType: 'JOB_COMPLETED', counterparty: 'accomplice', counterpartyScore: 300, grader: 'llm-review', createdAt: at(20 + i) }),
      ),
    )
    const diverse = withMarket(
      Array.from({ length: 12 }, (_, i) =>
        base({ eventType: 'JOB_COMPLETED', counterparty: `client-${i}`, counterpartyScore: 750, grader: 'llm-review', createdAt: at(20 + i) }),
      ),
    )
    expect(diverse.score).toBeGreaterThan(ring.score)
  })

  it('a defaulted loan still craters the score, and a two-year-old one craters it less', () => {
    const YEAR = 365 * 24 * 60 * 60 * 1000
    const nowLate = new Date(NOW.getTime() + 2 * YEAR)
    const history = Array.from({ length: 10 }, (_, i) => terminal(i))
    const clean = assessCredit(history, undefined, nowLate)
    const freshDefault = assessCredit(
      [...history, base({ eventType: 'REPAYMENT_DEFAULTED', success: false, qualityScore: null, createdAt: nowLate })],
      undefined,
      nowLate,
    )
    const oldDefault = assessCredit(
      [...history, base({ eventType: 'REPAYMENT_DEFAULTED', success: false, qualityScore: null, createdAt: NOW })],
      undefined,
      nowLate,
    )
    expect(freshDefault.score).toBeLessThan(clean.score)
    expect(oldDefault.score).toBeGreaterThanOrEqual(freshDefault.score) // time heals, slowly
  })
})
