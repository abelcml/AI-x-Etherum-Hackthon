/**
 * Retracting duplicate completion events, so the unique index can exist.
 *
 * `agent_events_job_completed_once` has been failing to build in production
 * because rows predating the guard credited the same job twice. Until it
 * exists, double-credit is prevented by application code alone, which loses
 * the concurrent case (see completion-index.ts).
 *
 * **The duplicates are not deleted.** This platform's whole claim is a track
 * record that cannot be manufactured, and quietly erasing rows from the ledger
 * to make a constraint fit is the same move in the opposite direction. A
 * duplicate is evidence of a defect that really happened; the honest fix is to
 * mark it as retracted, not to pretend it was never written.
 *
 * So the losing rows are re-typed to RETRACTED_EVENT_TYPE and stamped with why
 * and when. Every consumer of completion events — earnings, job counts, credit
 * scoring, the public agent list — filters on the exact string
 * `'JOB_COMPLETED'`, so a retracted row stops counting everywhere at once
 * without any of them needing to know this happened. It stays visible in raw
 * event feeds, which fall back to a generic icon for types they don't know.
 *
 * Idempotent: once run, no task_id has two live completions, so a second run
 * finds nothing and writes nothing. Dry by default — `apply` must be asked for.
 */
import { pool } from '@/lib/db'

/** Deliberately verbose and unmistakably non-canonical: this must never be
 *  confused with a completion by a future `startsWith`-style filter. */
export const RETRACTED_EVENT_TYPE = 'JOB_COMPLETED_RETRACTED'

export type CompletionRow = { id: string; taskId: string; createdAt: Date; agentId?: string }

export type DedupePlan = {
  /** Rows to keep — one per task_id. */
  keep: CompletionRow[]
  /** Rows to retract. */
  retract: CompletionRow[]
}

/**
 * Which completion survives, per task_id: the EARLIEST. The first credit is
 * the one the job actually earned; every later row is the race, the retry, or
 * the reconciliation sweep writing a second time. Ties break on id so two
 * operators running this against the same data reach the same answer — rows
 * written in the same transaction can share a timestamp to the microsecond.
 *
 * Pure, because this is the decision that decides which of an agent's earnings
 * rows is real, and it should be readable and testable without a database.
 */
export function planDedupe(rows: readonly CompletionRow[]): DedupePlan {
  const byTask = new Map<string, CompletionRow[]>()
  for (const r of rows) {
    const list = byTask.get(r.taskId)
    if (list) list.push(r)
    else byTask.set(r.taskId, [r])
  }
  const keep: CompletionRow[] = []
  const retract: CompletionRow[] = []
  for (const list of byTask.values()) {
    const ordered = [...list].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    keep.push(ordered[0])
    retract.push(...ordered.slice(1))
  }
  return { keep, retract }
}

const SELECT_DUPLICATE_ROWS = `
  SELECT id, task_id, created_at, agent_id
    FROM agent_events
   WHERE event_type = 'JOB_COMPLETED'
     AND task_id IN (
       SELECT task_id FROM agent_events
        WHERE event_type = 'JOB_COMPLETED'
        GROUP BY task_id HAVING count(*) > 1
     )
`

const RETRACT = `
  UPDATE agent_events
     SET event_type = $1,
         detail = coalesce(detail, '{}'::jsonb) || $2::jsonb
   WHERE id = ANY($3::text[])
     AND event_type = 'JOB_COMPLETED'
`

export type DedupeResult = {
  applied: boolean
  duplicatedTasks: string[]
  wouldRetract: number
  retracted: number
  /** Agents whose published earnings and job count this changes. Their credit
   *  must be recalculated afterwards or the ledger is corrected while the
   *  public score stays inflated — half a fix is the worse half. */
  affectedAgents: string[]
  /** Per task: which row survives and which are retracted — the audit trail
   *  for a mutation that changes what an agent is publicly credited with. */
  detail: { taskId: string; keep: string; retract: string[] }[]
}

export async function retractDuplicateCompletions(opts?: { apply?: boolean }): Promise<DedupeResult> {
  const apply = opts?.apply === true
  const { rows } = await pool.query<{ id: string; task_id: string; created_at: Date; agent_id: string }>(
    SELECT_DUPLICATE_ROWS,
  )
  const plan = planDedupe(
    rows.map((r) => ({ id: r.id, taskId: r.task_id, createdAt: new Date(r.created_at), agentId: r.agent_id })),
  )

  const detail = plan.keep
    .map((k) => ({
      taskId: k.taskId,
      keep: k.id,
      retract: plan.retract.filter((r) => r.taskId === k.taskId).map((r) => r.id),
    }))
    .sort((a, b) => (a.taskId < b.taskId ? -1 : 1))

  const result: DedupeResult = {
    applied: apply,
    duplicatedTasks: detail.map((d) => d.taskId),
    wouldRetract: plan.retract.length,
    retracted: 0,
    // Everyone who holds a row on either side of a duplicated task: the
    // retracted rows change what an agent is credited with, and the surviving
    // row may belong to a different agent than the duplicate did.
    affectedAgents: [...new Set([...plan.retract, ...plan.keep].map((r) => r.agentId).filter((a): a is string => !!a))],
    detail,
  }
  if (!apply || plan.retract.length === 0) return result

  const stamp = JSON.stringify({
    retractedReason: 'duplicate JOB_COMPLETED for the same task_id; the earliest row is authoritative',
    retractedAt: new Date().toISOString(),
  })
  const res = await pool.query(RETRACT, [RETRACTED_EVENT_TYPE, stamp, plan.retract.map((r) => r.id)])
  result.retracted = res.rowCount ?? 0
  return result
}
