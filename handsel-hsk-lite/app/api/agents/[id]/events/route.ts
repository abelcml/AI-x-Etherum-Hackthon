import { db } from '@/lib/db'
import { agentEvent } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { requireAgent, errorResponse } from '@/lib/api/agent-access'

/**
 * GET /api/agents/:id/events
 * Execution history: successes, failures, and reputation events.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireAgent(id)

    const limit = Math.min(
      200,
      Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 50),
    )

    const events = await db
      .select()
      .from(agentEvent)
      .where(eq(agentEvent.agentId, id))
      .orderBy(desc(agentEvent.createdAt))
      .limit(limit)

    return Response.json({
      events: events.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        eventType: e.eventType,
        success: e.success,
        executionTime: e.executionTime,
        tokenCost: e.tokenCost,
        qualityScore: e.qualityScore === null ? null : parseFloat(e.qualityScore),
        detail: e.detail,
        createdAt: e.createdAt,
      })),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
