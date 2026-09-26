/**
 * The default sweep: finds loans past due + grace and makes the default REAL —
 * status flipped, the REPAYMENT_DEFAULTED event written (the one the scoring
 * engine was designed around but nothing ever produced), the score
 * recalculated, and the fact announced on the platform feed.
 *
 * Idempotent by construction: the event id is keyed on the loan, so webhook-
 * style re-runs and concurrent sweeps cannot double-punish. Throttled and
 * best-effort like the settlement sweeps — safe from any hot path.
 */
import { db } from '@/lib/db'
import { agentEvent, creditTransaction, user } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { GRACE_DAYS, loanPhase, loanNoticeDue } from '@/lib/loan-terms'

const SWEEP_COOLDOWN_MS = 60_000

export async function sweepDefaultedLoans(now = new Date()): Promise<number> {
  // Cross-instance: marking a loan defaulted writes credit history, and two
  // lambdas doing it at once wrote it twice.
  const { acquireOpsLease } = await import('@/lib/ops-lease')
  if (!(await acquireOpsLease('loan-default-sweep', SWEEP_COOLDOWN_MS))) return 0

  let defaulted = 0
  try {
    await (await import('@/lib/db/ensure-columns')).ensureCreditTransactionColumns()

    const open = await db
      .select()
      .from(creditTransaction)
      .where(and(eq(creditTransaction.status, 'active'), eq(creditTransaction.type, 'credit_draw')))

    for (const loan of open) {
      if (loanPhase(now, loan.dueAt, GRACE_DAYS) !== 'defaulted') continue
      try {
        // Claim atomically: only the sweep instance that flips active →
        // defaulted writes the event, so a concurrent sweep is a no-op.
        const claimed = await db
          .update(creditTransaction)
          .set({ status: 'defaulted', defaultedAt: now, updatedAt: now })
          .where(and(eq(creditTransaction.id, loan.id), eq(creditTransaction.status, 'active')))
          .returning()
        if (claimed.length === 0) continue

        await db.insert(agentEvent).values({
          id: nanoid(),
          agentId: loan.fromAgentId,
          taskId: `default-${loan.id}`,
          eventType: 'REPAYMENT_DEFAULTED',
          success: false,
          executionTime: 0,
          tokenCost: 0,
          qualityScore: '0.000',
          detail: {
            amount: loan.amount,
            transactionId: loan.id,
            dueAt: loan.dueAt?.toISOString() ?? null,
            graceDays: GRACE_DAYS,
          },
        })

        const { recalculateCredit } = await import('@/lib/credit-engine')
        await recalculateCredit(loan.fromAgentId)

        const { logPlatformEvent } = await import('@/lib/platform-feed')
        await logPlatformEvent(
          'LOAN_DEFAULTED',
          `A $${parseFloat(loan.amount).toLocaleString()} credit draw went ${GRACE_DAYS} days past due and defaulted — the borrower's score takes the designed hit`,
        ).catch(() => {})

        defaulted++
      } catch (error) {
        console.error(`[loan-sweep] defaulting loan ${loan.id} failed:`, error)
      }
    }
  } catch (error) {
    console.error('[loan-sweep] sweep failed:', error)
  }
  return defaulted
}


/**
 * Loan lifecycle emails: due-soon → overdue → defaulted, one email per
 * phase TRANSITION per loan (remindedPhase is the high-water mark, so a
 * cron running hourly still emails each phase exactly once). Purely
 * additive to the money paths — an email failure never touches loan state,
 * and with email unconfigured this is a fast no-op.
 */
export async function sweepLoanReminders(now = new Date()): Promise<number> {
  const { isEmailConfigured, sendLoanEmail } = await import('@/lib/email')
  if (!isEmailConfigured()) return 0
  // Cross-instance: remindedPhase is read, compared, then written, so two
  // lambdas in the same window both saw the old phase and both emailed.
  const { acquireOpsLease } = await import('@/lib/ops-lease')
  if (!(await acquireOpsLease('loan-reminder-sweep', SWEEP_COOLDOWN_MS))) return 0

  let sent = 0
  try {
    await (await import('@/lib/db/ensure-columns')).ensureCreditTransactionColumns()
    const open = await db
      .select()
      .from(creditTransaction)
      .where(and(eq(creditTransaction.type, 'credit_draw'), inArray(creditTransaction.status, ['active', 'defaulted'])))

    for (const loan of open) {
      const phase = loanNoticeDue(now, loan, GRACE_DAYS)
      if (!phase) continue
      try {
        const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, loan.userId))
        if (!owner?.email) continue
        const result = await sendLoanEmail({
          to: owner.email,
          phase,
          amountUsd: parseFloat(loan.amount),
          dueAt: loan.dueAt,
          graceDays: GRACE_DAYS,
        })
        // Mark BEFORE judging delivery success? No — only a sent email
        // advances the high-water mark, so a transient Resend outage means
        // a retry next sweep, not a silently skipped notice.
        if (result.sent) {
          await db
            .update(creditTransaction)
            .set({ remindedPhase: phase, updatedAt: now })
            .where(eq(creditTransaction.id, loan.id))
          sent++
        }
      } catch (error) {
        console.error(`[loan-sweep] reminder for loan ${loan.id} failed:`, error)
      }
    }
  } catch (error) {
    console.error('[loan-sweep] reminder sweep failed:', error)
  }
  return sent
}
