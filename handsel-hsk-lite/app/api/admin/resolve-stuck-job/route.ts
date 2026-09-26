import { db } from '@/lib/db'
import { jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Admin cleanup for a Submitted job that can't auto-settle (grader
 * unavailable, hit the auto-repost cap, ungradable deliverable): refund the
 * escrow to the requester and close it, or (rarely) release to the worker.
 *
 *   POST /api/admin/resolve-stuck-job?job_id=N&action=refund|pay&secret=...
 *
 * action defaults to 'refund' (dispute → resolve to requester). Guarded by
 * CRON_SECRET.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  const { requireOperator } = await import('@/lib/admin-route')
  const auth = requireOperator(request, { mutating: true })
  if (!auth.ok) return auth.response
  const url = new URL(request.url)

  const jobId = Number(url.searchParams.get('job_id'))
  const action = (url.searchParams.get('action') ?? 'refund').toLowerCase()
  if (!Number.isInteger(jobId)) return Response.json({ error: 'job_id required' }, { status: 400 })
  if (action !== 'refund' && action !== 'pay') return Response.json({ error: 'action must be refund or pay' }, { status: 400 })

  try {
    const { readJobs, raiseDispute, resolveDispute, approveJob } = await import('@/lib/onchain/labor')
    const jobs = await readJobs({ maxAgeMs: 0 })
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return Response.json({ error: `job #${jobId} not found on-chain` }, { status: 404 })
    if (job.status !== 'Submitted') {
      return Response.json({ error: `job #${jobId} is ${job.status}, not Submitted — nothing to resolve` }, { status: 409 })
    }

    // Find the requester agent (needed to sign the dispute) via the spec.
    const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash))
    if (!spec?.requesterAgentId) return Response.json({ error: 'no requester agent for this job' }, { status: 404 })

    if (action === 'pay') {
      const txHash = await approveJob(spec.requesterAgentId, jobId)
      await db.update(jobSpec).set({ disputeNote: 'Admin: manually released to worker' }).where(eq(jobSpec.specHash, job.specHash))
      return Response.json({ status: 'ok', jobId, action, txHash })
    }

    // refund: requester disputes → arbiter resolves to requester.
    await raiseDispute(spec.requesterAgentId, jobId)
    const txHash = await resolveDispute(jobId, false)
    await db
      .update(jobSpec)
      .set({ disputeNote: 'Admin: stuck job cleaned up — escrow refunded to requester' })
      .where(eq(jobSpec.specHash, job.specHash))
    return Response.json({ status: 'ok', jobId, action, title: spec.title, bounty: job.bounty, txHash })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
