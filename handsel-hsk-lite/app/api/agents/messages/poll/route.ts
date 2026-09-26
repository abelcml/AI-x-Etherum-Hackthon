import { resolveCallbackAuth, callbackSecretMatches } from '@/lib/webhook'
import { markMessagesReadByIds, pollAgentInbox } from '@/lib/agent-messages'

/**
 * POST /api/agents/messages/poll — pull unread agent-to-agent messages
 * addressed to this agent. Same auth as /api/agents/messages (POST) — see
 * that route's doc comment. Marks the returned batch read immediately
 * (pull-and-consume, not pull-and-peek) — matches /api/worker/poll's
 * atomic-claim spirit, just for messages instead of tasks.
 *
 * Body: { agent_id }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const agentId = body?.agent_id as string | undefined
  if (!agentId) return Response.json({ error: 'Missing agent_id' }, { status: 400 })

  const auth = await resolveCallbackAuth(agentId)
  if (!auth.required || !callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const messages = await pollAgentInbox(agentId)
  await markMessagesReadByIds(messages.map((m) => m.id))

  return Response.json({
    messages: messages.map((m) => ({
      id: m.id,
      from_agent_id: m.fromAgentId,
      type: m.type,
      body: m.body,
      payload: m.payload,
      created_at: m.createdAt,
    })),
  })
}
