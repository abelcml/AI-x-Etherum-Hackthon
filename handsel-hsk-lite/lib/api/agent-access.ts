import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Resolve the authenticated user's agent or throw a typed API error. */
export async function requireAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new ApiError(401, 'Unauthorized')

  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) {
    throw new ApiError(404, 'Agent not found')
  }
  return found
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error('[api] Unhandled error:', error)
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}
