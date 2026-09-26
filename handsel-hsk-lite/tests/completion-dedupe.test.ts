import { describe, expect, it } from 'vitest'
import { planDedupe, RETRACTED_EVENT_TYPE, type CompletionRow } from '@/lib/db/completion-dedupe'

const row = (id: string, taskId: string, iso: string, agentId = 'w1'): CompletionRow => ({
  id,
  taskId,
  createdAt: new Date(iso),
  agentId,
})

describe('planDedupe — which earnings row is the real one', () => {
  it('keeps the earliest completion and retracts the rest', () => {
    const { keep, retract } = planDedupe([
      row('c', 'job-4', '2026-07-01T00:00:03Z'),
      row('a', 'job-4', '2026-07-01T00:00:01Z'),
      row('b', 'job-4', '2026-07-01T00:00:02Z'),
    ])
    expect(keep.map((r) => r.id)).toEqual(['a'])
    expect(retract.map((r) => r.id).sort()).toEqual(['b', 'c'])
  })

  it('leaves a task with a single completion completely alone', () => {
    const { keep, retract } = planDedupe([row('a', 'job-9', '2026-07-01T00:00:01Z')])
    expect(keep.map((r) => r.id)).toEqual(['a'])
    expect(retract).toEqual([])
  })

  it('handles several duplicated tasks independently', () => {
    const { keep, retract } = planDedupe([
      row('a1', 'job-1', '2026-07-01T00:00:01Z'),
      row('a2', 'job-1', '2026-07-01T00:00:02Z'),
      row('b1', 'job-2', '2026-07-01T00:00:05Z'),
      row('b2', 'job-2', '2026-07-01T00:00:04Z'),
    ])
    expect(keep.map((r) => r.id).sort()).toEqual(['a1', 'b2'])
    expect(retract.map((r) => r.id).sort()).toEqual(['a2', 'b1'])
  })

  it('breaks exact timestamp ties deterministically, not by row order', () => {
    // Two writers racing inside one transaction can share a timestamp to the
    // microsecond. Without a tiebreak, two operators running this against the
    // same data would retract different rows.
    const same = '2026-07-01T00:00:00Z'
    const forward = planDedupe([row('zz', 'job-4', same), row('aa', 'job-4', same)])
    const reversed = planDedupe([row('aa', 'job-4', same), row('zz', 'job-4', same)])
    expect(forward.keep.map((r) => r.id)).toEqual(['aa'])
    expect(reversed.keep.map((r) => r.id)).toEqual(['aa'])
  })

  it('is idempotent: replanning over what survives finds nothing to do', () => {
    const first = planDedupe([
      row('a', 'job-4', '2026-07-01T00:00:01Z'),
      row('b', 'job-4', '2026-07-01T00:00:02Z'),
    ])
    const second = planDedupe(first.keep)
    expect(second.retract).toEqual([])
    expect(second.keep.map((r) => r.id)).toEqual(['a'])
  })

  it('never loses a row — every input is either kept or retracted, exactly once', () => {
    const input = [
      row('a', 'job-1', '2026-07-01T00:00:01Z'),
      row('b', 'job-1', '2026-07-01T00:00:02Z'),
      row('c', 'job-2', '2026-07-01T00:00:03Z'),
    ]
    const { keep, retract } = planDedupe(input)
    expect([...keep, ...retract].map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('the retracted type', () => {
  it('cannot be mistaken for a completion by an exact-match filter', () => {
    // Every consumer — earnings, job counts, credit scoring, the public agent
    // list — compares eventType to this exact string.
    expect(RETRACTED_EVENT_TYPE).not.toBe('JOB_COMPLETED')
  })

  it('is not a prefix of the canonical type, so a startsWith filter cannot catch it backwards', () => {
    expect('JOB_COMPLETED'.startsWith(RETRACTED_EVENT_TYPE)).toBe(false)
  })
})
