import { describe, expect, it } from 'vitest'
import { counterpartyEdgeQuery, otherPartnerCounts, type TradeEdge } from '@/lib/credit-engine/counterparty-graph'
import {
  collateralizedVolume,
  counterpartyBucket,
  INDEPENDENCE_MIN_PARTNERS,
  isIndependentCounterparty,
  POOLED_COUNTERPARTY,
  weightedMarketSignal,
  type AgentEventInput,
  type SettledTrade,
} from '@/lib/credit-engine/scoring'

const AT = new Date('2026-07-01T00:00:00Z')
const NOW = new Date('2026-07-01T00:00:00Z') // no recency decay in these tests

function completion(counterparty: string, otherPartners: number | null, i = 0): AgentEventInput {
  return {
    eventType: 'JOB_COMPLETED',
    success: true,
    executionTime: 1,
    tokenCost: 0,
    qualityScore: 1,
    createdAt: new Date(AT.getTime() + i * 1000),
    counterparty,
    counterpartyOtherPartners: otherPartners,
    counterpartyScore: 700, // established on paper — the graph is the only thing that differs
    grader: 'tests',
    exposureUsd: 10, // exposure weight exactly 1.0 at the reference bounty
  }
}

describe('otherPartnerCounts — the graph fact', () => {
  it('counts a star leaf at zero: a requester who only ever hired me', () => {
    const edges: TradeEdge[] = [
      { requester: 'acc1', worker: 'me' },
      { requester: 'acc1', worker: 'me' },
      { requester: 'acc2', worker: 'me' },
    ]
    const counts = otherPartnerCounts(edges, 'me')
    expect(counts.get('acc1')).toBe(0)
    expect(counts.get('acc2')).toBe(0)
  })

  it('counts distinct workers, not trades', () => {
    const edges: TradeEdge[] = [
      { requester: 'r', worker: 'me' },
      { requester: 'r', worker: 'w1' },
      { requester: 'r', worker: 'w1' },
      { requester: 'r', worker: 'w1' },
      { requester: 'r', worker: 'w2' },
    ]
    expect(otherPartnerCounts(edges, 'me').get('r')).toBe(2)
  })

  it('never counts me as my counterparty’s other partner', () => {
    const edges: TradeEdge[] = Array.from({ length: 50 }, () => ({ requester: 'r', worker: 'me' }))
    expect(otherPartnerCounts(edges, 'me').get('r')).toBe(0)
  })

  it('ignores malformed edges rather than counting an empty id as a partner', () => {
    const edges = [
      { requester: 'r', worker: '' },
      { requester: '', worker: 'w1' },
      { requester: 'r', worker: 'w1' },
    ] as TradeEdge[]
    expect(otherPartnerCounts(edges, 'me').get('r')).toBe(1)
  })
})

describe('the edge query compiles to the statement it claims to', () => {
  // otherPartnersByCounterparty catches every error and reports everyone
  // independent, so a broken query degrades to "feature does nothing" with no
  // symptom. This is the only place that failure can be caught.
  const compiled = () => counterpartyEdgeQuery(['acc1', 'acc2']).toSQL()

  it('reads the requester out of the JSON detail, not a column', () => {
    expect(compiled().sql).toContain(`->>'requesterAgentId'`)
  })

  it('scopes to settled work', () => {
    expect(compiled().params).toContain('JOB_COMPLETED')
  })

  it('binds the ids as parameters rather than splicing them into the text', () => {
    const { sql: text, params } = compiled()
    expect(params).toContain('acc1')
    expect(params).toContain('acc2')
    expect(text).not.toContain('acc1')
  })

  it("survives an id containing a quote, because it isn't string-built", () => {
    const { sql: text, params } = counterpartyEdgeQuery(["a'; drop table agent_events; --"]).toSQL()
    expect(text).not.toContain('drop table')
    expect(params).toContain("a'; drop table agent_events; --")
  })
})

describe('isIndependentCounterparty', () => {
  it('treats "not computed" as independent — no retroactive penalty', () => {
    expect(isIndependentCounterparty(null)).toBe(true)
    expect(isIndependentCounterparty(undefined)).toBe(true)
  })

  it('requires INDEPENDENCE_MIN_PARTNERS distinct others', () => {
    for (let n = 0; n < INDEPENDENCE_MIN_PARTNERS; n++) expect(isIndependentCounterparty(n)).toBe(false)
    expect(isIndependentCounterparty(INDEPENDENCE_MIN_PARTNERS)).toBe(true)
    expect(isIndependentCounterparty(INDEPENDENCE_MIN_PARTNERS + 99)).toBe(true)
  })
})

describe('counterpartyBucket', () => {
  it('gives an independent counterparty its own bucket', () => {
    expect(counterpartyBucket('r', 5)).toBe('r')
  })

  it('pools every non-independent counterparty into one', () => {
    expect(counterpartyBucket('acc1', 0)).toBe(POOLED_COUNTERPARTY)
    expect(counterpartyBucket('acc2', 1)).toBe(POOLED_COUNTERPARTY)
    expect(counterpartyBucket('acc1', 0)).toBe(counterpartyBucket('acc2', 0))
  })

  it('leaves a null counterparty null, so legacy history keeps its behaviour', () => {
    expect(counterpartyBucket(null, 0)).toBeNull()
    expect(counterpartyBucket(undefined, null)).toBeNull()
  })
})

describe('the attack this exists to stop', () => {
  const farm = (n: number, tradesEach: number, otherPartners: number) =>
    Array.from({ length: n }, (_, a) =>
      Array.from({ length: tradesEach }, (_, t) => completion(`acc${a}`, otherPartners, a * tradesEach + t)),
    ).flat()

  it('was linear in the number of accomplices before pooling', () => {
    // Same farm, but each accomplice passes the independence test.
    const ten = weightedMarketSignal(farm(10, 4, 9), 'JOB_COMPLETED', NOW)
    const forty = weightedMarketSignal(farm(40, 4, 9), 'JOB_COMPLETED', NOW)
    expect(forty / ten).toBeCloseTo(4, 5) // 4x the accounts, 4x the reputation
  })

  it('converges once accomplices share a bucket, no matter how many are minted', () => {
    const ten = weightedMarketSignal(farm(10, 4, 0), 'JOB_COMPLETED', NOW)
    const forty = weightedMarketSignal(farm(40, 4, 0), 'JOB_COMPLETED', NOW)
    const thousand = weightedMarketSignal(farm(1000, 4, 0), 'JOB_COMPLETED', NOW)
    expect(forty).toBeLessThan(ten * 1.05)
    expect(thousand).toBeLessThan(ten * 1.05)
    // Σ 0.5^k → 2. These counterparties are score-700, so every other weight
    // here is exactly 1 and the bound shows up undisguised: the WHOLE farm is
    // worth two full-weight trades. Not two per accomplice — two, total,
    // across a thousand accounts.
    expect(thousand).toBeLessThanOrEqual(2)
    expect(thousand).toBeCloseTo(2, 6)
  })

  it('leaves an honest agent with genuinely diverse clients untouched', () => {
    const honest = [
      completion('client-a', 7, 0),
      completion('client-b', 12, 1),
      completion('client-c', 4, 2),
      completion('client-d', 30, 3),
    ]
    const withGraph = weightedMarketSignal(honest, 'JOB_COMPLETED', NOW)
    const withoutGraph = weightedMarketSignal(
      honest.map((e) => ({ ...e, counterpartyOtherPartners: null })),
      'JOB_COMPLETED',
      NOW,
    )
    expect(withGraph).toBeCloseTo(withoutGraph, 10)
  })

  it('still lets the first trade with a fresh client count for something', () => {
    // A worker should not be punished to zero for being someone's first hire.
    const first = weightedMarketSignal([completion('brand-new', 0, 0)], 'JOB_COMPLETED', NOW)
    expect(first).toBeGreaterThan(0)
  })
})

describe('the lending ceiling uses the same buckets', () => {
  const trade = (counterparty: string, otherPartners: number | null, i: number): SettledTrade => ({
    amountUsd: 50,
    counterparty,
    counterpartyScore: 700,
    counterpartyOtherPartners: otherPartners,
    createdAt: new Date(AT.getTime() + i * 1000),
  })

  it('collapses a ring of accomplices into one partner’s worth of collateral', () => {
    const farmed = Array.from({ length: 30 }, (_, i) => trade(`acc${i}`, 0, i))
    const diverse = Array.from({ length: 30 }, (_, i) => trade(`client${i}`, 6, i))
    expect(collateralizedVolume(farmed)).toBeLessThan(collateralizedVolume(diverse) / 10)
  })

  it('does not re-weight legacy trades that never recorded a counterparty', () => {
    const legacy: SettledTrade[] = Array.from({ length: 5 }, (_, i) => ({
      amountUsd: 20,
      counterparty: null,
      counterpartyScore: null,
      createdAt: new Date(AT.getTime() + i * 1000),
    }))
    const before = collateralizedVolume(legacy)
    const after = collateralizedVolume(legacy.map((t) => ({ ...t, counterpartyOtherPartners: 0 })))
    expect(after).toBe(before)
  })
})
