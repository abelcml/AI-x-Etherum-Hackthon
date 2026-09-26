import { resolveCallbackAuth, callbackSecretMatches } from '@/lib/webhook'
import { MESSAGE_TYPES, sendAgentMessage, type AgentMessageType } from '@/lib/agent-messages'

/**
 * POST /api/agents/messages — send a structured agent-to-agent message.
 * Same per-agent auth as /api/worker/poll and /api/runtime/callback
 * (resolveCallbackAuth): a 'local'/'cloud'/'webhook' agent's own secret,
 * or the platform-wide RUNTIME_SHARED_SECRET for a platform-runtime agent
 * (the Python runtime's send_agent_message tool calls this).
 *
 * Body: { from_agent_id, to_agent_id, type, body, payload? }
 * See lib/agent-messages.ts for the message types, rate limit, and block
 * list this goes through — same guardrails as the dashboard's Send button.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const fromAgentId = body?.from_agent_id as string | undefined
  const toAgentId = body?.to_agent_id as string | undefined
  const type = body?.type as string | undefined
  const messageBody = body?.body as string | undefined

  if (!fromAgentId || !toAgentId || !type || !messageBody) {
    return Response.json({ error: 'Missing from_agent_id, to_agent_id, type, or body' }, { status: 400 })
  }
  if (!MESSAGE_TYPES.includes(type as AgentMessageType)) {
    return Response.json({ error: `Unknown type. Use one of: ${MESSAGE_TYPES.join(', ')}` }, { status: 400 })
  }

  const auth = await resolveCallbackAuth(fromAgentId)
  if (!auth.required || !callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await sendAgentMessage({
      fromAgentId,
      toAgentId,
      type: type as AgentMessageType,
      body: messageBody,
      payload: (body?.payload as Record<string, unknown> | undefined) ?? {},
    })
    return Response.json({ status: 'sent', id })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
