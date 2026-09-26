import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Perform an open IMAGE job end-to-end, server-side — accept (capability /
 * self-deal checks) → generate a real 1024px image (pollinations) → POST the
 * runtime callback with it as an inline artifact → vision grading settles the
 * escrow. The image analogue of work-audio-job; lets an image subtask be
 * completed without a running desktop. Guarded by CRON_SECRET.
 *
 *   POST /api/admin/work-image-job?job_id=N&agent=<worker name>&secret=...
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 160

export async function POST(request: Request): Promise<Response> {
  const { requireOperator } = await import('@/lib/admin-route')
  const auth = requireOperator(request, { mutating: true })
  if (!auth.ok) return auth.response
  const url = new URL(request.url)

  const jobId = Number(url.searchParams.get('job_id'))
  const agentName = url.searchParams.get('agent') ?? ''
  if (!Number.isInteger(jobId)) return Response.json({ error: 'job_id required' }, { status: 400 })
  if (!agentName) return Response.json({ error: 'agent (worker name) required' }, { status: 400 })

  let [worker] = await db.select().from(agent).where(eq(agent.name, agentName))
  if (!worker) return Response.json({ error: `no agent named "${agentName}"` }, { status: 404 })

  // Ensure the worker declares the 'image' capability (admin demo convenience).
  if (!(worker.capabilities ?? []).includes('image')) {
    const caps = [...new Set([...(worker.capabilities ?? ['text']), 'image'])]
    await db.update(agent).set({ capabilities: caps }).where(eq(agent.id, worker.id))
    worker = { ...worker, capabilities: caps }
  }

  try {
    const { acceptJobForExternalWorker } = await import('@/lib/labor-dispatch')
    const { taskId, prompt, bounty } = await acceptJobForExternalWorker(worker, jobId)

    // The prompt to draw = title + description, minus the acceptance-criteria
    // boilerplate (the generator shouldn't render the grading rubric).
    const imgPrompt = (prompt.split('Acceptance criteria')[0] ?? prompt).replace(/\s+/g, ' ').trim().slice(0, 400)
    const { generateImage } = await import('@/lib/demo-run')
    const img = await generateImage(imgPrompt)
    const size = Math.floor((img.base64.length * 3) / 4)

    const { resolveCallbackAuth } = await import('@/lib/webhook')
    const cbAuth = await resolveCallbackAuth(worker.id)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cbAuth.required) headers['X-Runtime-Secret'] = cbAuth.secret
    const res = await fetch(`${url.origin}/api/runtime/callback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task_id: taskId,
        agent_id: worker.id,
        success: true,
        output: `Generated image for: ${imgPrompt}`,
        artifacts: [{ name: 'image.jpg', mime: img.mime, data_base64: img.base64, size }],
        quality_score: null,
        execution_time: 5,
        token_cost: 0,
        events: [],
      }),
    })
    const grading = await res.json().catch(() => null)
    return Response.json({ status: 'ok', jobId, worker: worker.name, bounty, imgPrompt, imageBytes: size, callback: grading })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
