import { describe, it, expect } from 'vitest'
import { feeForBounty } from '@/lib/platform-fee'
import {
  collateralizedVolume,
  collateralizedCreditLimit,
  COLLATERAL_MULTIPLE,
  CREDIBILITY_FLOOR,
  type SettledTrade,
} from '@/lib/credit-engine/scoring'

// The fee and the collateral cap are the two economic defenses the Sybil
// self-attack showed were missing: farming was free, and a farmed score
// bought real borrowing power. These tests pin the math that closes both.

describe('feeForBounty', () => {
  it('charges the bps rate rounded to cents', () => {
    expect(feeForBounty(5, 200)).toBe(0.1) // 2% of $5
    expect(feeForBounty(100, 200)).toBe(2)
    expect(feeForBounty(1.234, 200)).toBe(0.02)
  })

  it('floors at one cent while enabled — micro-postings are not a free lane', () => {
    expect(feeForBounty(0.01, 200)).toBe(0.01)
  })

  it('is zero when disabled or for non-positive bounties', () => {
    expect(feeForBounty(100, 0)).toBe(0)
    expect(feeForBounty(0, 200)).toBe(0)
    expect(feeForBounty(-5, 200)).toBe(0)
  })

  it('makes wash-trade cost proportional to farmed volume', () => {
    // 50 fake $10 jobs cost the ring 50 × $0.20 = $10 — 2% of everything
    // it pretended to trade, paid to the house.
    const total = Array.from({ length: 50 }, () => feeForBounty(10, 200)).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(10)
  })
})

describe('collateralizedVolume', () => {
  const trade = (amountUsd: number, counterparty: string | null, counterpartyScore: number | null, day: number): SettledTrade => ({
    amountUsd,
    counterparty,
    counterpartyScore,
    createdAt: new Date(Date.UTC(2026, 0, 1 + day)),
  })

  it('caps a single-counterparty ring at ~2 trades of volume', () => {
    // 100 × $10 wash trades with one credible partner → halving converges:
    // 10 × (1 + 0.5 + 0.25 + …) → $20, no matter how patient the ring is.
    const trades = Array.from({ length: 100 }, (_, i) => trade(10, 'ring-partner', 700, i))
    const v = collateralizedVolume(trades)
    expect(v).toBeGreaterThan(19.9)
    expect(v).toBeLessThanOrEqual(20)
  })

  it('prices fresh-account accomplices at the credibility floor', () => {
    // A brand-new score-300 accomplice's first $100 trade collateralizes $25.
    expect(collateralizedVolume([trade(100, 'fresh', 300, 0)])).toBeCloseTo(100 * CREDIBILITY_FLOOR)
  })

  it('pools legacy no-counterparty trades into ONE floored bucket', () => {
    // Unknown history gets no benefit of the doubt in lending: same bucket
    // (halving applies across them) AND the stranger floor.
    const v = collateralizedVolume([trade(100, null, null, 0), trade(100, null, null, 1)])
    expect(v).toBeCloseTo(100 * CREDIBILITY_FLOOR + 100 * 0.5 * CREDIBILITY_FLOOR)
  })

  it('rewards genuine diversity linearly', () => {
    // Five different established requesters, $10 each → full $50.
    const trades = Array.from({ length: 5 }, (_, i) => trade(10, `req-${i}`, 700, i))
    expect(collateralizedVolume(trades)).toBeCloseTo(50)
  })
})

describe('collateralizedCreditLimit', () => {
  it('lets collateral, not score, set the binding constraint', () => {
    // A farmed score proposing $10,000 with only $20 of ring collateral
    // can borrow at most 2 × $20.
    const ring = Array.from({ length: 100 }, (_, i) => ({
      amountUsd: 10,
      counterparty: 'ring',
      counterpartyScore: 700,
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
    }))
    const limit = collateralizedCreditLimit(10_000, ring)
    expect(limit).toBeLessThanOrEqual(COLLATERAL_MULTIPLE * 20)
  })

  it('never raises the score-derived limit', () => {
    const rich = Array.from({ length: 10 }, (_, i) => ({
      amountUsd: 1000,
      counterparty: `c${i}`,
      counterpartyScore: 700,
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
    }))
    expect(collateralizedCreditLimit(500, rich)).toBe(500)
  })

  it('gives a cold start zero borrowing power regardless of score', () => {
    expect(collateralizedCreditLimit(25_000, [])).toBe(0)
  })
})

/**
 * Unknown ≠ affordable. `collectPostingFee` used to skip its affordability
 * check when the balance read failed, which charged the fee blind — and then
 * the escrow reverts on `USDC: balance`, so the requester is out the fee with
 * no job and no refund path. That is the precise outcome the check exists to
 * prevent, reached by the check's own error handling.
 */
describe('posting fee under an unreadable balance', () => {
  it('waives rather than charges blind', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../lib/platform-fee.ts', import.meta.url), 'utf8'),
    )
    // The null branch must return before any transfer, not fall through it.
    const nullBranch = src.indexOf('balanceUsd === null')
    const transfer = src.indexOf('await transferUsdc(')
    expect(nullBranch).toBeGreaterThan(-1)
    expect(nullBranch).toBeLessThan(transfer)
    expect(src.slice(nullBranch, transfer)).toContain('fee waived')
  })
})
