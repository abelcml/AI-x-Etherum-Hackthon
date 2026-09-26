import { db } from '@/lib/db'
import { agentTask, taskProgress } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { resolveCallbackAuth, callbackSecretMatches } from '@/lib/webhook'

/**
 * POST /api/runtime/progress — live, best-effort step updates while a task
 * is still running (PLAN_CREATED, TOOL_EXECUTED, ...), pushed by the Python
 * runtime as each one happens. Purely cosmetic: /api/runtime/callback (the
 * final result) remains the sole write path for agent_events/credit. A
 * failure here is swallowed by the caller and never affects the run.
 *
 * Same per-agent auth as the final callback — a webhook agent's owner can
 * never forge progress for another agent's task.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const taskId = body?.task_id as string | undefined
  const event = body?.event as { event_type?: string; detail?: unknown } | undefined
  if (!taskId || !event?.event_type) {
    return Response.json({ error: 'Missing task_id or event' }, { status: 400 })
  }

  const [taskRow] = await db.select().from(agentTask).where(eq(agentTask.id, taskId))
  if (!taskRow) return Response.json({ status: 'ignored' }) // unknown task — idempotent no-op

  const auth = await resolveCallbackAuth(taskRow.agentId)
  if (auth.required && !callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await db.insert(taskProgress).values({
    id: nanoid(),
    taskId,
    eventType: String(event.event_type),
    detail: event.detail ?? {},
  })

  // Progress IS liveness: reapStuckTasks() times out on updatedAt, so a
  // heartbeat from a legitimately long run (video render, big batch)
  // resets its clock. Only while genuinely in flight — a terminal task's
  // timestamps stay put.
  if (taskRow.status === 'running' || taskRow.status === 'processing') {
    await db
      .update(agentTask)
      .set({ updatedAt: new Date() })
      .where(eq(agentTask.id, taskId))
  }

  return Response.json({ status: 'ok' })
}
