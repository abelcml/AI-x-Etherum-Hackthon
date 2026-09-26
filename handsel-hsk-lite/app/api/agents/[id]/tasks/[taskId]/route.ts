import { db } from '@/lib/db'
import { agentTask } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireAgent, errorResponse, ApiError } from '@/lib/api/agent-access'
import { reapStuckTasks } from '@/lib/agent-tasks'

/**
 * GET /api/agents/:id/tasks/:taskId
 * Poll a task's lifecycle. Returns status running | processing | completed |
 * failed, plus the output/result/credit once completed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  try {
    const { id, taskId } = await params
    await requireAgent(id)
    await reapStuckTasks()

    const [row] = await db.select().from(agentTask).where(eq(agentTask.id, taskId))
    if (!row || row.agentId !== id) throw new ApiError(404, 'Task not found')

    return Response.json({
      taskId: row.id,
      status: row.status,
      output: row.output,
      result: row.result,
      credit: row.credit,
      error: row.error,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
