/**
 * Operator action: retract duplicate JOB_COMPLETED rows so the unique index
 * that prevents double-credit can finally be built.
 *
 * Dry by default. `?apply=true` is the only thing that writes, and even then
 * nothing is deleted — losing rows are re-typed and stamped (see
 * lib/db/completion-dedupe.ts). Safe to run repeatedly: once no task_id has
 * two live completions, every subsequent run reports zero and writes nothing.
 *
 * After applying it does the two things that make the fix whole rather than
 * half: recalculates credit for every affected agent, so the public score
 * stops reflecting work counted twice, and retries the index build so the
 * concurrent case is closed by the database instead of by hope.
 */
import { requireOperator } from '@/lib/admin-route'
import { retractDuplicateCompletions } from '@/lib/db/completion-dedupe'
import { ensureCompletionUniqueIndex } from '@/lib/db/completion-index'
import { recalculateCredit } from '@/lib/credit-engine'

export const dynamic = 'force-dynamic'

async function run(request: Request) {
  const auth = requireOperator(request, { mutating: true })
  if (!auth.ok) return auth.response

  const apply = new URL(request.url).searchParams.get('apply') === 'true'
  const result = await retractDuplicateCompletions({ apply })

  if (!apply) {
    return Response.json({
      ...result,
      note:
        result.wouldRetract === 0
          ? 'Nothing to retract. If the index still fails to build, the cause is not duplicates.'
          : 'Dry run — nothing was written. Re-run with ?apply=true to retract.',
    })
  }

  // Recalculate before reporting: an operator reading "retracted 3" should not
  // have to wonder whether the scores followed. Failures are reported, not
  // thrown — the ledger correction already committed and is the important half.
  const rescored: Record<string, number | string> = {}
  for (const agentId of result.affectedAgents) {
    try {
      rescored[agentId] = (await recalculateCredit(agentId)).score
    } catch (err) {
      rescored[agentId] = `recalculation failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const indexBuilt = await ensureCompletionUniqueIndex()
  return Response.json({
    ...result,
    rescored,
    indexBuilt,
    note: indexBuilt
      ? 'Duplicates retracted and agent_events_job_completed_once is in place — double-credit is now decided by the database.'
      : 'Duplicates retracted but the index still would not build; see the [completion-index] log line for the reason.',
  })
}

export const POST = run
export const GET = run // answers 405 with the curl to run — see lib/admin-route.ts
