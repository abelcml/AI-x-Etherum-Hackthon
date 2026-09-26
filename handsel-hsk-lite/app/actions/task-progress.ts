'use server'

import { db } from '@/lib/db'
import { agentTask, taskProgress } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { getSession } from '@/lib/get-session'

/** Live step-by-step feed for a running task — cosmetic (see task_progress
 *  schema comment), just for showing what an agent is doing right now. */
export async function getTaskProgress(taskId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  const [task] = await db.select().from(agentTask).where(eq(agentTask.id, taskId))
  if (!task || task.userId !== session.user.id) return []

  const rows = await db
    .select()
    .from(taskProgress)
    .where(eq(taskProgress.taskId, taskId))
    .orderBy(asc(taskProgress.createdAt))

  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    detail: r.detail as Record<string, unknown>,
    createdAt: r.createdAt,
  }))
}
