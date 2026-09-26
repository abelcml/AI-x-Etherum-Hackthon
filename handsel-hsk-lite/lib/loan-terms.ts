/**
 * Loan terms — the spine that makes credit REAL.
 *
 * Before this file, a "loan" here was a ledger row with no maturity: an agent
 * could draw against its credit line and simply never repay, and nothing
 * anywhere would ever notice. The scoring engine reads REPAYMENT_DEFAULTED as
 * its strongest negative signal (×25) — but no code path ever produced that
 * event. A credit system in which default is impossible is not a credit
 * system; it is a decoration.
 *
 * What this adds, and deliberately nothing more:
 *
 *   • a TERM — every draw now has a due date;
 *   • a GRACE window — late is a state, not instantly a default;
 *   • DEFAULT — past grace, the loan is marked, the REPAYMENT_DEFAULTED
 *     event finally exists, and the score takes the hit it was always
 *     designed to take;
 *   • a DELINQUENCY GATE — an owner with an overdue or defaulted loan
 *     cannot draw more anywhere on the account.
 *
 * What it deliberately does NOT add: interest. An interest number that no
 * rail actually collects would be fake data — the platform's founding
 * anti-principle. Terms and default are the teeth; pricing can come when
 * there is a collection rail for it.
 *
 * Pure functions only — the sweep and actions wire these to the database.
 */

export const DEFAULT_TERM_DAYS = 14
export const GRACE_DAYS = 3

export type LoanPhase = 'active' | 'overdue' | 'defaulted'

const DAY_MS = 24 * 60 * 60 * 1000

/** When a draw made at `drawnAt` falls due. */
export function dueAtFor(drawnAt: Date, termDays: number = DEFAULT_TERM_DAYS): Date {
  const days = Number.isFinite(termDays) && termDays > 0 ? termDays : DEFAULT_TERM_DAYS
  return new Date(drawnAt.getTime() + days * DAY_MS)
}

/**
 * Where an unpaid loan stands right now. A loan with no due date (drawn
 * before terms existed) is grandfathered as perpetually 'active' — imposing
 * a retroactive deadline nobody agreed to would be a rug-pull, not a policy.
 */
export function loanPhase(now: Date, dueAt: Date | null, graceDays: number = GRACE_DAYS): LoanPhase {
  if (!dueAt) return 'active'
  const t = now.getTime()
  if (t <= dueAt.getTime()) return 'active'
  if (t <= dueAt.getTime() + graceDays * DAY_MS) return 'overdue'
  return 'defaulted'
}

/** Days until due (negative = past due). For UI countdowns. */
export function daysUntilDue(now: Date, dueAt: Date): number {
  return Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS)
}

/** How many days before maturity the "due soon" notice fires. */
export const DUE_SOON_DAYS = 3

export type LoanNoticePhase = 'due-soon' | 'overdue' | 'defaulted'

const NOTICE_RANK: Record<LoanNoticePhase, number> = { 'due-soon': 1, overdue: 2, defaulted: 3 }

/**
 * Which notification (if any) a loan deserves right now. Phases only move
 * forward — comparing against the last-notified phase makes the reminder
 * sweep idempotent per phase, never per run. Grandfathered term-less loans
 * notify nothing, matching their perpetual-active status.
 */
export function loanNoticeDue(
  now: Date,
  loan: { dueAt: Date | null; status: string; remindedPhase?: string | null },
  graceDays: number = GRACE_DAYS,
): LoanNoticePhase | null {
  if (!loan.dueAt) return null
  if (loan.status !== 'active' && loan.status !== 'defaulted') return null

  let phase: LoanNoticePhase | null = null
  if (loan.status === 'defaulted') phase = 'defaulted'
  else {
    const p = loanPhase(now, loan.dueAt, graceDays)
    if (p === 'defaulted') phase = 'defaulted'
    else if (p === 'overdue') phase = 'overdue'
    else if (loan.dueAt.getTime() - now.getTime() <= DUE_SOON_DAYS * DAY_MS) phase = 'due-soon'
  }
  if (!phase) return null

  const last = loan.remindedPhase as LoanNoticePhase | undefined | null
  if (last && NOTICE_RANK[last] !== undefined && NOTICE_RANK[last] >= NOTICE_RANK[phase]) return null
  return phase
}

export type OpenLoan = { dueAt: Date | null; status: string }

/**
 * The delinquency gate: may this owner draw MORE credit right now?
 *
 * Any loan already marked defaulted, or currently past due (even inside
 * grace — grace forgives the score hit, not the borrowing freeze), blocks
 * every new draw account-wide. This is the discipline that makes the due
 * date mean something before the default sweep has even run.
 */
export function canDrawMore(now: Date, openLoans: OpenLoan[]): { ok: boolean; reason: string } {
  for (const loan of openLoans) {
    if (loan.status === 'defaulted') {
      return { ok: false, reason: 'You have a defaulted loan — repay it before drawing more credit.' }
    }
    if (loan.status === 'active' && loan.dueAt && now.getTime() > loan.dueAt.getTime()) {
      return { ok: false, reason: 'You have a past-due loan — repay it before drawing more credit.' }
    }
  }
  return { ok: true, reason: 'no delinquent loans' }
}

/**
 * Outstanding debt must include DEFAULTED loans. The naive filter
 * (status === 'active') makes a defaulted loan vanish from the books —
 * so the moment a borrower defaults, their available credit would go UP.
 * Kept here as the single named predicate so no call site re-derives it.
 */
export const OUTSTANDING_STATUSES = ['active', 'defaulted'] as const

export function isOutstandingStatus(status: string): boolean {
  return (OUTSTANDING_STATUSES as readonly string[]).includes(status)
}
