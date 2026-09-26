/**
 * Loan terms — the state machine that turned credit from a decoration into a
 * system. Two invariants matter above all: default must be REACHABLE (the
 * scoring engine's strongest penalty was unreachable code before this), and
 * defaulted debt must stay ON the books (the naive status filter made a
 * default RAISE the borrower's available credit).
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERM_DAYS,
  GRACE_DAYS,
  canDrawMore,
  daysUntilDue,
  dueAtFor,
  isOutstandingStatus,
  loanPhase,
} from '@/lib/loan-terms'

const DAY = 24 * 60 * 60 * 1000
const t0 = new Date('2026-07-01T00:00:00Z')

describe('dueAtFor', () => {
  it('matures a draw after the term', () => {
    expect(dueAtFor(t0, 14).getTime()).toBe(t0.getTime() + 14 * DAY)
  })
  it('falls back to the default term on nonsense', () => {
    expect(dueAtFor(t0, 0).getTime()).toBe(t0.getTime() + DEFAULT_TERM_DAYS * DAY)
    expect(dueAtFor(t0, NaN).getTime()).toBe(t0.getTime() + DEFAULT_TERM_DAYS * DAY)
  })
})

describe('loanPhase — the ladder is active → overdue (grace) → defaulted', () => {
  const due = new Date(t0.getTime() + 14 * DAY)
  it('is active until the due date, inclusive', () => {
    expect(loanPhase(new Date(due.getTime()), due)).toBe('active')
    expect(loanPhase(new Date(due.getTime() - DAY), due)).toBe('active')
  })
  it('is overdue inside the grace window', () => {
    expect(loanPhase(new Date(due.getTime() + 1), due)).toBe('overdue')
    expect(loanPhase(new Date(due.getTime() + GRACE_DAYS * DAY), due)).toBe('overdue')
  })
  it('defaults past grace', () => {
    expect(loanPhase(new Date(due.getTime() + GRACE_DAYS * DAY + 1), due)).toBe('defaulted')
  })
  it('grandfathers term-less legacy loans instead of retroactively defaulting them', () => {
    expect(loanPhase(new Date('2030-01-01'), null)).toBe('active')
  })
})

describe('canDrawMore — the delinquency gate', () => {
  const due = new Date(t0.getTime() + 14 * DAY)
  it('allows drawing with current loans only', () => {
    expect(canDrawMore(t0, [{ dueAt: due, status: 'active' }]).ok).toBe(true)
    expect(canDrawMore(t0, []).ok).toBe(true)
  })
  it('blocks account-wide on a past-due loan, even inside grace', () => {
    const gate = canDrawMore(new Date(due.getTime() + DAY), [{ dueAt: due, status: 'active' }])
    expect(gate.ok).toBe(false)
    expect(gate.reason).toMatch(/past-due/)
  })
  it('blocks on a defaulted loan regardless of dates', () => {
    expect(canDrawMore(t0, [{ dueAt: null, status: 'defaulted' }]).ok).toBe(false)
  })
  it('ignores settled loans', () => {
    expect(canDrawMore(t0, [{ dueAt: new Date(t0.getTime() - 30 * DAY), status: 'settled' }]).ok).toBe(true)
  })
})

describe('outstanding statuses — defaulted debt stays on the books', () => {
  it('counts active AND defaulted as outstanding', () => {
    expect(isOutstandingStatus('active')).toBe(true)
    expect(isOutstandingStatus('defaulted')).toBe(true)
  })
  it('does not count settled', () => {
    expect(isOutstandingStatus('settled')).toBe(false)
  })
})

describe('daysUntilDue', () => {
  const due = new Date(t0.getTime() + 3 * DAY)
  it('counts down and goes negative past due', () => {
    expect(daysUntilDue(t0, due)).toBe(3)
    expect(daysUntilDue(new Date(due.getTime() + 2 * DAY), due)).toBe(-2)
  })
})
