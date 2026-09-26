import { db } from '@/lib/db'
import { creditScoreEntry } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { requireAgent, errorResponse } from '@/lib/api/agent-access'

/**
 * GET /api/agents/:id/credit-history
 * Score changes, credit limit changes, and the reason for each recalculation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireAgent(id)

    const history = await db
      .select()
      .from(creditScoreEntry)
      .where(eq(creditScoreEntry.agentId, id))
      .orderBy(desc(creditScoreEntry.createdAt))
      .limit(100)

    return Response.json({
      history: history.map((entry) => ({
        id: entry.id,
        score: entry.score,
        rating: entry.rating,
        creditLimit: parseFloat(entry.creditLimit),
        riskLevel: entry.riskLevel,
        calculationReason: entry.calculationReason,
        breakdown: entry.breakdown,
        createdAt: entry.createdAt,
      })),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
