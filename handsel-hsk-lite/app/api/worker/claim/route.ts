import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { resolveCallbackAuth, callbackSecretMatches } from '@/lib/webhook'

// The on-chain accept happens inside the request (Sepolia blocks ~12s);
// give it the same headroom /api/worker/poll's auto-mine accept gets.
export const maxDuration = 60

/**
 * POST /api/worker/claim — a worker takes ONE specific Open job by id.
 *
 * `/api/worker/poll` only returns tasks that were already dispatched to this
 * agent's queue (by auto-mine or a delegation). That makes the poll-only
 * worker a passive recipient — it can't walk up to the open market and pick a
 * job. A MANUAL worker (e.g. a person working the job in-game) needs exactly
 * that: browse `/api/tasks`, choose one, claim it, do it.
 *
 * This is the worker-secret-authenticated twin of the MCP `claim_job` tool.
 * Both call the same `acceptJobForExternalWorker()`, so the on-chain accept,
 * the failed-lineage / capability / min-score gates, the off-chain claim, and
 * the task row are identical no matter who claims. Submission still flows
 * through `/api/runtime/callback` with this same per-agent secret, so grading,
 * credit, and settlement cannot drift from the model-worker path.
 *
 * Body: { agent_id, job_id }
 * → { task_id, prompt, bounty }  (the prompt is the full task to work)
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const agentId = body?.agent_id as string | undefined
  const jobId = Number(body?.job_id)
  if (!agentId) return Response.json({ error: 'Missing agent_id' }, { status: 400 })
  if (!Number.isInteger(jobId) || jobId < 0) {
    return Response.json({ error: 'Missing or invalid job_id' }, { status: 400 })
  }

  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!ag) return Response.json({ error: 'Unknown agent' }, { status: 404 })

  const auth = await resolveCallbackAuth(agentId)
  if (!auth.required || !callbackSecretMatches(auth, request.headers.get('x-runtime-secret'))) {
    // Server-side only: name which precondition failed, never any secret
    // material. A bare 401 across ID-vs-key-vs-stale-key is undiagnosable.
    // Length + an 8-char hash prefix separates "same key, mangled in transit"
    // from "a different key entirely" without revealing either value.
    const presented = request.headers.get('x-runtime-secret')
    const { createHash } = await import('node:crypto')
    const sha8 = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 8)
    const expected = auth.required ? auth.secret : ''
    console.warn(
      `[worker/claim] auth failed for agent ${agentId}: ` +
        (!auth.required ? 'agent has no key and no shared secret is configured' : presented ? 'presented key does not match the stored key' : 'no x-runtime-secret header presented') +
        (auth.required && presented
          ? ` (presented len=${presented.length} sha8=${sha8(presented.trim())}, stored len=${expected.length} sha8=${sha8(expected)})`
          : ''),
    )
    // Worker keys are always 64-char hex; a presented value of any other
    // length is a different credential pasted in the wrong slot (usually the
    // ~200-char connector personal token). Say so in the response — the shape
    // of the wrong value is not a secret, and the worker's operator sees this
    // message in their own logs.
    const looksLikeWrongCredential = presented !== null && presented.trim().length !== 64
    return Response.json(
      {
        error: looksLikeWrongCredential
          ? `Unauthorized: the presented credential (${presented!.trim().length} chars) is not a worker key. Use the 64-character hex Callback secret from the agent's card on /profile — not the connector personal token.`
          : 'Unauthorized',
      },
      { status: 401 },
    )
  }
  if (!ag.smartAccountAddress) {
    return Response.json(
      { error: 'Agent has no on-chain wallet yet — provision it on the dashboard first.' },
      { status: 409 },
    )
  }

  try {
    const { acceptJobForExternalWorker } = await import('@/lib/labor-dispatch')
    const { taskId, prompt, bounty } = await acceptJobForExternalWorker(ag, jobId)
    return Response.json({ task_id: taskId, prompt, bounty })
  } catch (e) {
    // These are expected, user-facing refusals (job taken, self-deal, score
    // too low, capability mismatch) — surface the reason, don't 500.
    const message = e instanceof Error ? e.message : 'claim failed'
    return Response.json({ error: message }, { status: 409 })
  }
}
