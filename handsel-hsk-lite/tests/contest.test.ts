import { describe, expect, it } from 'vitest'
import { contestWeek, parsePrizeUsd, rankWeeklyEarnings } from '@/lib/contest'

describe('contestWeek', () => {
  it('a mid-week instant maps to the surrounding Mon→Mon UTC window', () => {
    // 2026-07-22 is a Wednesday.
    const w = contestWeek(new Date('2026-07-22T15:30:00Z'))
    expect(w.start.toISOString()).toBe('2026-07-20T00:00:00.000Z') // Monday
    expect(w.end.toISOString()).toBe('2026-07-27T00:00:00.000Z')
  })

  it('Monday 00:00 UTC starts its own week; Sunday belongs to the previous one', () => {
    const mon = contestWeek(new Date('2026-07-20T00:00:00Z'))
    expect(mon.start.toISOString()).toBe('2026-07-20T00:00:00.000Z')
    const sun = contestWeek(new Date('2026-07-26T23:59:59Z'))
    expect(sun.start.toISOString()).toBe('2026-07-20T00:00:00.000Z')
  })
})

describe('parsePrizeUsd', () => {
  it('positive numbers enable; unset/zero/garbage disable', () => {
    expect(parsePrizeUsd('20')).toBe(20)
    expect(parsePrizeUsd('12.5')).toBe(12.5)
    expect(parsePrizeUsd(undefined)).toBeNull()
    expect(parsePrizeUsd('')).toBeNull()
    expect(parsePrizeUsd('0')).toBeNull()
    expect(parsePrizeUsd('-5')).toBeNull()
    expect(parsePrizeUsd('twenty')).toBeNull()
  })
})

describe('rankWeeklyEarnings', () => {
  it('sums per agent and ranks by earnings, then job count', () => {
    const ranked = rankWeeklyEarnings([
      { agentId: 'a', detail: { bounty: 5 } },
      { agentId: 'b', detail: { bounty: 12 } },
      { agentId: 'a', detail: { bounty: 8 } },
      { agentId: 'c', detail: { bounty: 13 } },
      { agentId: 'b', detail: { bounty: 1 } },
    ])
    expect(ranked.map((r) => r.agentId)).toEqual(['a', 'b', 'c'])
    expect(ranked[0]).toEqual({ agentId: 'a', earnedUsd: 13, jobs: 2 })
    // a and c both earned 13 — a wins on more jobs delivered.
  })

  it('tolerates events with missing bounty detail', () => {
    const ranked = rankWeeklyEarnings([
      { agentId: 'a', detail: null },
      { agentId: 'a', detail: { bounty: 3 } },
    ])
    expect(ranked[0]).toEqual({ agentId: 'a', earnedUsd: 3, jobs: 2 })
  })
})
