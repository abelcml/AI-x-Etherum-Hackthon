import { db } from '@/lib/db'
import { agentEvent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireAgent, errorResponse } from '@/lib/api/agent-access'

/**
 * GET /api/agents/:id
 * Agent identity, performance metrics, and current credit state.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const agent = await requireAgent(id)

    const events = await db.select().from(agentEvent).where(eq(agentEvent.agentId, id))
    const tasks = events.filter(
      (e) => e.eventType === 'TASK_COMPLETED' || e.eventType === 'TASK_FAILED',
    )
    const completed = tasks.filter((e) => e.eventType === 'TASK_COMPLETED' && e.success)
    const totalTokens = tasks.reduce((sum, e) => sum + e.tokenCost, 0)
    const qualities = completed
      .filter((e) => e.qualityScore !== null)
      .map((e) => parseFloat(e.qualityScore as string))

    return Response.json({
      identity: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        walletAddress: agent.walletAddress,
        modelVersion: agent.modelVersion,
        createdAt: agent.createdAt,
      },
      performance: {
        totalTasks: tasks.length,
        completedTasks: completed.length,
        failedTasks: tasks.length - completed.length,
        successRate: tasks.length > 0 ? completed.length / tasks.length : null,
        avgQuality:
          qualities.length > 0 ? qualities.reduce((a, b) => a + b, 0) / qualities.length : null,
        totalTokenCost: totalTokens,
      },
      credit: {
        score: Math.round(parseFloat(agent.creditScore)),
        rating: agent.creditRating,
        creditLimit: parseFloat(agent.totalCreditLine ?? '0'),
        availableCredit: parseFloat(agent.availableCredit ?? '0'),
        riskLevel: agent.riskLevel,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
