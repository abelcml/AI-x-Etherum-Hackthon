import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { resolveCallbackAuth, callbackSecretMatches } from '@/lib/webhook'
import { normalizeCapabilities } from '@/lib/artifacts'

/**
 * POST /api/worker/capabilities — a worker updates its own declared
 * capabilities (e.g. the desktop Miner turning image mining on/off).
 *
 * Worker-secret auth is the right scope here: the secret authorizes
 * "doing work", and capabilities only declare WHAT work this worker can
 * be matched to — no money moves, and over-declaring only earns failed
 * gradings (which cost the agent its own credit score).
 *
 * Body: { agent_id, capabilities: ["text", "image", ...] }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const agentId = body?.agent_id as string | undefined
  if (!agentId) return Response.json({ error: 'Missing agent_id' }, { status: 400 })

  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!ag) return Response.json({ error: 'Agent not found' }, { status: 404 })

  const auth = await resolveCallbackAuth(agentId)
  if (!auth.required || !callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const capabilities = normalizeCapabilities(body?.capabilities)
  await db.update(agent).set({ capabilities, updatedAt: new Date() }).where(eq(agent.id, agentId))
  return Response.json({ capabilities })
}
