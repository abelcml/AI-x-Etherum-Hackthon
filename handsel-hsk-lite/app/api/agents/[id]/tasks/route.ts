import { runAgentTask } from '@/lib/agent-tasks'
import { requireAgent, errorResponse, ApiError } from '@/lib/api/agent-access'

/**
 * POST /api/agents/:id/tasks
 * Starts a task and returns immediately — either on the platform's
 * Claude-powered Python runtime, or (if the agent is configured with a
 * webhook) on the owner's own infrastructure. Either way, execution is
 * async: the runtime/webhook calls /api/runtime/callback on completion,
 * which persists events and recalculates credit. The client polls
 * GET /api/agents/:id/tasks/:taskId for the result.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const agent = await requireAgent(id)

    const body = await request.json().catch(() => null)
    const task = typeof body?.task === 'string' ? body.task.trim() : ''
    if (!task) throw new ApiError(400, 'Request body must include a non-empty "task" string')
    if (task.length > 4000) throw new ApiError(400, 'Task must be 4000 characters or fewer')

    const callbackUrl = `${new URL(request.url).origin}/api/runtime/callback`

    try {
      const { taskId } = await runAgentTask({ agent, task, callbackUrl })
      return Response.json({ taskId, status: 'running' })
    } catch (error) {
      throw new ApiError(502, `Failed to start task (${error instanceof Error ? error.message : String(error)})`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}
