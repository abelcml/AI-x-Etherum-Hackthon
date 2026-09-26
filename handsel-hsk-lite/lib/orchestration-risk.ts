/**
 * Prime orchestration risk — the risk an escrow-collateralized advance is
 * actually exposed to.
 *
 * See `docs/product-thesis.md`. The narrow product is: lend a prime contractor
 * the money to escrow its subcontractors, against the parent bounty that is
 * already locked on-chain. Because that collateral is observable, the lender's
 * exposure is NOT default — it is that the prime never finishes, the parent
 * escrow never releases, and the collateral therefore never materialises.
 *
 * The credit score does not measure that. It measures how well an agent
 * delivers a job it was handed: worker execution. Coordinating N
 * subcontractors, handling a dependency wave, and getting an integration check
 * to pass is a different event, and an agent can be reliably good at the first
 * while being bad at the second. Correlated, not identical.
 *
 * So this file measures the second thing separately rather than folding it into
 * the score. Two reasons, and the second is the real one:
 *
 *  1. Silently re-weighting every existing agent's score on a new signal would
 *     move published numbers for reasons no one could read off the page.
 *  2. In the framing this exists to serve, orchestration risk does not belong
 *     in the score at all — it belongs in **LTV**. Collateral decides whether
 *     to lend; this decides how much.
 *
 * Everything here is pure. The event rows come from the caller.
 */

/** Written on the PRIME agent when a delegation reaches a terminal state. */
export const DELEGATION_COMPLETED = 'DELEGATION_COMPLETED'
export const DELEGATION_FAILED = 'DELEGATION_FAILED'

export type OrchestrationEvent = {
  eventType: string
  /** Subtasks that produced a deliverable. */
  delivered: number
  /** Subtasks that were work (excludes the zero-bounty integration check). */
  total: number
  /** The delegation's budget — what was at stake in this attempt. */
  budgetUsd: number
  createdAt: Date
}

/**
 * A delegation is only a SUCCESS if every piece landed and the integration
 * check, when there was one, passed. Partial delivery is a failure here even
 * though the platform still assembles an output from what arrived: for a
 * lender, "eight of ten parts" means the parent bounty did not release, which
 * is the same outcome as zero.
 *
 * This is deliberately harsher than the delegation's own `status`, which goes
 * to 'completed' whenever every subtask reaches a terminal state — delivered
 * or failed. That status answers "is the pipeline done"; this answers "did the
 * customer get what they paid for", and only the second one prices a loan.
 */
export function delegationSucceeded(input: {
  delivered: number
  total: number
  integrationFailed: boolean
}): boolean {
  if (input.integrationFailed) return false
  if (input.total <= 0) return false
  return input.delivered >= input.total
}

export type OrchestrationRecord = {
  attempts: number
  completed: number
  failed: number
  /** Share of attempts that delivered in full. Null when there is no history —
   *  distinct from 0, which is a measured record of failing. */
  completionRate: number | null
  /** Largest budget this agent has ever carried to a full delivery. Null with
   *  no completed attempt. The size question is separate from the rate
   *  question: an agent that has finished ten $5 delegations has said nothing
   *  about whether it can finish a $500 one. */
  largestCompletedUsd: number | null
}

export function orchestrationRecord(events: readonly OrchestrationEvent[]): OrchestrationRecord {
  const attempts = events.filter((e) => e.eventType === DELEGATION_COMPLETED || e.eventType === DELEGATION_FAILED)
  const completed = attempts.filter((e) => e.eventType === DELEGATION_COMPLETED)
  const budgets = completed.map((e) => e.budgetUsd).filter((b) => Number.isFinite(b) && b > 0)
  return {
    attempts: attempts.length,
    completed: completed.length,
    failed: attempts.length - completed.length,
    completionRate: attempts.length === 0 ? null : completed.length / attempts.length,
    largestCompletedUsd: budgets.length === 0 ? null : Math.max(...budgets),
  }
}

/** No history at all: lend at this fraction of collateral. Not zero — the
 *  collateral is real and observable, so a first-time prime is not unfundable;
 *  it is just the case where the lender carries all of the execution risk. */
export const LTV_COLD_START = 0.5
/** The ceiling. Never 1.0: at full LTV a completion failure costs the lender
 *  the entire advance, and gas and time are not recoverable either. */
export const LTV_MAX = 0.9
export const LTV_MIN = 0.25
/** Attempts needed before the observed rate is trusted at face value. Below
 *  this the rate is blended toward the cold-start prior, so one lucky first
 *  delegation cannot buy the maximum advance. */
export const LTV_CONFIDENCE_ATTEMPTS = 5

/**
 * Loan-to-collateral for an escrow-collateralized advance.
 *
 * Shrinkage toward the cold-start prior is the whole design. Without it, one
 * completed delegation reads as a 100% completion rate, and "borrow at the
 * ceiling after a single $5 job" is precisely the farm the rest of this
 * codebase spends its effort preventing.
 *
 * Size is capped separately by the caller: this returns a RATIO, and a prime
 * whose largest completed delegation is $5 should not get 90% of $500 just
 * because the ratio says so. `advanceLimit` applies that.
 */
export function orchestrationLtv(record: OrchestrationRecord): number {
  if (record.completionRate === null) return LTV_COLD_START
  const confidence = Math.min(1, record.attempts / LTV_CONFIDENCE_ATTEMPTS)
  const blended = LTV_COLD_START + (record.completionRate - LTV_COLD_START) * confidence
  return Math.min(LTV_MAX, Math.max(LTV_MIN, Math.round(blended * 100) / 100))
}

/** How much larger a delegation an agent may be advanced against than the
 *  largest it has ever actually finished. Room to grow, not a blank cheque. */
export const STEP_UP_MULTIPLE = 2

/**
 * The advance itself: a fraction of observable collateral, additionally capped
 * so a prime cannot jump orders of magnitude past its demonstrated ceiling in
 * one step.
 *
 * A cold-start prime has no demonstrated ceiling, so only the ratio binds —
 * which is the honest answer, because with no record there is nothing to step
 * up from and the collateral is still real.
 */
export function advanceLimit(collateralUsd: number, record: OrchestrationRecord): number {
  if (!Number.isFinite(collateralUsd) || collateralUsd <= 0) return 0
  const byRatio = collateralUsd * orchestrationLtv(record)
  const ceiling =
    record.largestCompletedUsd === null ? byRatio : Math.min(byRatio, record.largestCompletedUsd * STEP_UP_MULTIPLE)
  return Math.round(ceiling * 100) / 100
}
