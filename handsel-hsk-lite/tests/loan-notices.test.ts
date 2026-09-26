import { describe, it, expect } from 'vitest'
import { loanNoticeDue, DUE_SOON_DAYS, GRACE_DAYS } from '@/lib/loan-terms'
import { renderEmailHtml } from '@/lib/email'

const DAY = 24 * 60 * 60 * 1000

describe('loanNoticeDue', () => {
  const due = new Date('2026-08-01T00:00:00Z')
  const loan = (over: Partial<{ dueAt: Date | null; status: string; remindedPhase: string | null }>) => ({
    dueAt: due,
    status: 'active',
    remindedPhase: null,
    ...over,
  })

  it('is silent while the due date is far away', () => {
    const now = new Date(due.getTime() - (DUE_SOON_DAYS + 2) * DAY)
    expect(loanNoticeDue(now, loan({}))).toBe(null)
  })

  it('fires due-soon inside the window, once', () => {
    const now = new Date(due.getTime() - 1 * DAY)
    expect(loanNoticeDue(now, loan({}))).toBe('due-soon')
    expect(loanNoticeDue(now, loan({ remindedPhase: 'due-soon' }))).toBe(null)
  })

  it('escalates forward but never backward', () => {
    const pastDue = new Date(due.getTime() + 1 * DAY) // inside grace
    expect(loanNoticeDue(pastDue, loan({ remindedPhase: 'due-soon' }))).toBe('overdue')
    // an already-sent overdue notice suppresses the weaker due-soon forever
    const backInWindow = new Date(due.getTime() - 1 * DAY)
    expect(loanNoticeDue(backInWindow, loan({ remindedPhase: 'overdue' }))).toBe(null)
  })

  it('notifies default exactly once, from either path', () => {
    const wayPast = new Date(due.getTime() + (GRACE_DAYS + 1) * DAY)
    expect(loanNoticeDue(wayPast, loan({}))).toBe('defaulted') // sweep hasn't flipped status yet
    expect(loanNoticeDue(wayPast, loan({ status: 'defaulted', remindedPhase: 'overdue' }))).toBe('defaulted')
    expect(loanNoticeDue(wayPast, loan({ status: 'defaulted', remindedPhase: 'defaulted' }))).toBe(null)
  })

  it('grandfathered term-less loans never notify', () => {
    expect(loanNoticeDue(new Date(), loan({ dueAt: null }))).toBe(null)
  })

  it('settled loans never notify', () => {
    const wayPast = new Date(due.getTime() + 30 * DAY)
    expect(loanNoticeDue(wayPast, loan({ status: 'settled' }))).toBe(null)
  })
})

describe('renderEmailHtml', () => {
  it('escapes user-influenced content', () => {
    const html = renderEmailHtml({ title: '<script>x</script>', bodyLines: ['a & b'] })
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
  })
})
