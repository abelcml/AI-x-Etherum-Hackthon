/**
 * HTTP client for the Python agent runtime (agent-runtime/).
 *
 * The runtime is asynchronous: startAgentTask() kicks off the run and returns
 * as soon as the runtime has accepted it (HTTP 202). The runtime later POSTs
 * the events + result to our callback endpoint, which persists them and
 * recalculates credit. This keeps every serverless request short.
 */

export type RuntimeEvent = {
  agent_id: string
  task_id: string
  event_type: string
  success: boolean
  execution_time: number
  token_cost: number
  quality_score: number | null
  detail: Record<string, unknown>
}

export type AgentRunResult = {
  task_id: string
  agent_id: string
  success: boolean
  output: string
  plan: string
  quality_score: number
  evaluation?: string
  token_cost: number
  execution_time: number
  events: RuntimeEvent[]
}

/**
 * Normalize AGENT_RUNTIME_URL: a bare host like "svc.up.railway.app" (no
 * scheme) makes fetch() throw "Failed to parse URL", so default a missing
 * scheme to https and trim any trailing slash.
 */
function resolveRuntimeUrl(): string {
  const raw = (process.env.AGENT_RUNTIME_URL ?? 'http://localhost:8000').trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

const RUNTIME_URL = resolveRuntimeUrl()
const RUNTIME_SECRET = process.env.RUNTIME_SHARED_SECRET ?? ''

/** Ask the runtime to start a task; resolves once it has been accepted. */
export async function startAgentTask(input: {
  agentId: string
  taskId: string
  task: string
  callbackUrl: string
  /** BYOK: bill this run to the user's own Anthropic key (never logged). */
  apiKey?: string | null
}): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (RUNTIME_SECRET) headers['X-Runtime-Secret'] = RUNTIME_SECRET

  const response = await fetch(`${RUNTIME_URL}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: input.agentId,
      task_id: input.taskId,
      task: input.task,
      callback_url: input.callbackUrl,
      ...(input.apiKey ? { api_key: input.apiKey } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(`Agent runtime responded ${response.status}: ${await response.text()}`)
  }
}
