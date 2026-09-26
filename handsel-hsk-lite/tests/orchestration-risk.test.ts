import { describe, expect, it } from 'vitest'
import {
  advanceLimit,
  delegationSucceeded,
  DELEGATION_COMPLETED,
  DELEGATION_FAILED,
  LTV_COLD_START,
  LTV_CONFIDENCE_ATTEMPTS,
  LTV_MAX,
  orchestrationLtv,
  orchestrationRecord,
  STEP_UP_MULTIPLE,
  type OrchestrationEvent,
} from '@/lib/orchestration-risk'

const at = (i: number) => new Date(Date.UTC(2026, 6, 1, 0, 0, i))
const ev = (ok: boolean, budgetUsd = 20, i = 0): OrchestrationEvent => ({
  eventType: ok ? DELEGATION_COMPLETED : DELEGATION_FAILED,
  delivered: ok ? 4 : 2,
  total: 4,
  budgetUsd,
  createdAt: at(i),
})

describe('delegationSucceeded — stricter than the row status', () => {
  it('needs every part delivered', () => {
    expect(delegationSucceeded({ delivered: 4, total: 4, integrationFailed: false })).toBe(true)
    expect(delegationSucceeded({ delivered: 3, total: 4, integrationFailed: false })).toBe(false)
  })

  it('counts a failed integration check as a failed delegation even when every part landed', () => {
    // The pieces arrived and do not work together. The customer did not get
    // what they paid for, so the parent escrow does not release.
    expect(delegationSucceeded({ delivered: 4, total: 4, integrationFailed: true })).toBe(false)
  })

  it('does not call an empty delegation a success', () => {
    expect(delegationSucceeded({ delivered: 0, total: 0, integrationFailed: false })).toBe(false)
  })
})

describe('orchestrationRecord', () => {
  it('distinguishes "no history" from "a history of failing"', () => {
    expect(orchestrationRecord([]).completionRate).toBeNull()
    expect(orchestrationRecord([ev(false)]).completionRate).toBe(0)
  })

  it('ignores unrelated event types', () => {
    const noise = { ...ev(true), eventType: 'JOB_COMPLETED' }
    expect(orchestrationRecord([noise, ev(true, 20, 1)]).attempts).toBe(1)
  })

  it('reports the largest budget actually carried to a full delivery, not the largest attempted', () => {
    const r = orchestrationRecord([ev(true, 20, 0), ev(false, 500, 1)])
    expect(r.largestCompletedUsd).toBe(20)
  })
})

describe('orchestrationLtv — one lucky delegation must not buy the ceiling', () => {
  it('lends against collateral at the cold-start ratio with no history', () => {
    expect(orchestrationLtv(orchestrationRecord([]))).toBe(LTV_COLD_START)
  })

  it('does not jump to the maximum after a single success', () => {
    const one = orchestrationLtv(orchestrationRecord([ev(true)]))
    expect(one).toBeGreaterThan(LTV_COLD_START)
    expect(one).toBeLessThan(LTV_MAX)
  })

  it('approaches the observed rate only as attempts accumulate', () => {
    const perfect = (n: number) => orchestrationRecord(Array.from({ length: n }, (_, i) => ev(true, 20, i)))
    const few = orchestrationLtv(perfect(2))
    const enough = orchestrationLtv(perfect(LTV_CONFIDENCE_ATTEMPTS))
    expect(enough).toBeGreaterThan(few)
    expect(enough).toBe(LTV_MAX) // a perfect record at full confidence hits the cap
  })

  it('a consistent failer is floored, not zeroed — the collateral is still real', () => {
    const bad = orchestrationRecord(Array.from({ length: 10 }, (_, i) => ev(false, 20, i)))
    const ltv = orchestrationLtv(bad)
    expect(ltv).toBeGreaterThan(0)
    expect(ltv).toBeLessThan(LTV_COLD_START)
  })

  it('never reaches full collateral value', () => {
    const perfect = orchestrationRecord(Array.from({ length: 50 }, (_, i) => ev(true, 20, i)))
    expect(orchestrationLtv(perfect)).toBeLessThan(1)
  })
})

describe('advanceLimit — ratio and step-up both bind', () => {
  it('is zero without collateral, whatever the record says', () => {
    const perfect = orchestrationRecord(Array.from({ length: 10 }, (_, i) => ev(true, 500, i)))
    expect(advanceLimit(0, perfect)).toBe(0)
    expect(advanceLimit(-5, perfect)).toBe(0)
  })

  it('stops a prime jumping orders of magnitude past what it has finished', () => {
    // Ten perfect $5 delegations. The ratio would allow 90% of $500; the
    // step-up cap says $5 x 2.
    const small = orchestrationRecord(Array.from({ length: 10 }, (_, i) => ev(true, 5, i)))
    expect(advanceLimit(500, small)).toBe(5 * STEP_UP_MULTIPLE)
  })

  it('lets a cold-start prime borrow against real collateral', () => {
    // Nothing to step up from, so only the ratio binds. Refusing entirely
    // would be wrong: the collateral is observable and does not depend on the
    // borrower's history.
    expect(advanceLimit(100, orchestrationRecord([]))).toBe(100 * LTV_COLD_START)
  })

  it('lets the ratio bind when the demonstrated ceiling is already high', () => {
    const big = orchestrationRecord(Array.from({ length: 10 }, (_, i) => ev(true, 1000, i)))
    expect(advanceLimit(100, big)).toBe(100 * LTV_MAX)
  })
})
