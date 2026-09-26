'use server'

import { headers } from 'next/headers'
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentTask, verifiableTask } from '@/lib/db/schema'
import { desc, eq, inArray, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { randomBytes } from 'node:crypto'
import { generateProblem, problemPrompt, type Difficulty } from '@/lib/verifiable/problems'
import { startAgentTask } from '@/lib/agent-runtime/client'
import { asActionError } from '@/lib/action-error'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function requireOwnedAgent(agentId: string, userId: string) {
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== userId) throw new Error('Agent not found')
  return found
}

export async function getVerifiedTasks() {
  const userId = await requireUser()
  const { isVerifiedEscrowConfigured, EXPLORER_URL } = await import('@/lib/onchain/config')

  const agents = await db.select().from(agent).where(eq(agent.userId, userId))
  const myAgentIds = agents.map((a) => a.id)

  // Tasks I posted (requester) OR tasks proposed/dispatched to my own agent
  // as solver — cross-user proposals land here as the latter, even though
  // I didn't touch verifiableTask.userId (that's still the requester's).
  const rows =
    myAgentIds.length > 0
      ? await db
          .select()
          .from(verifiableTask)
          .where(or(eq(verifiableTask.userId, userId), inArray(verifiableTask.solverAgentId, myAgentIds)))
          .orderBy(desc(verifiableTask.createdAt))
          .limit(30)
      : []

  // A cross-user task's counterpart agent belongs to someone else — resolve
  // those names too, not just my own agents.
  const otherIds = [...new Set(rows.flatMap((r) => [r.solverAgentId, r.requesterAgentId]))].filter(
    (id) => !myAgentIds.includes(id),
  )
  const others = otherIds.length > 0 ? await db.select({ id: agent.id, name: agent.name }).from(agent).where(inArray(agent.id, otherIds)) : []
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? others.find((a) => a.id === id)?.name ?? id

  return {
    configured: isVerifiedEscrowConfigured(),
    explorer: EXPLORER_URL,
    myAgents: agents.map((a) => ({ id: a.id, name: a.name, provisioned: Boolean(a.smartAccountAddress) })),
    tasks: rows.map((r) => ({
      id: r.id,
      solver: name(r.solverAgentId),
      requester: name(r.requesterAgentId),
      // Which side (if any) of this task I'm on — drives the Accept/Decline
      // buttons and the reclaim button, since both are owner-specific.
      iAmSolver: myAgentIds.includes(r.solverAgentId),
      iAmRequester: r.userId === userId,
      difficulty: r.difficulty,
      problem: r.problem,
      bountyUsd: parseFloat(r.bountyUsd),
      status: r.status,
      submittedAnswer: r.submittedAnswer,
      // The hidden answer is only exposed once the task is settled or failed.
      answer: r.status === 'completed' || r.status === 'failed' ? r.answer : null,
      postTxHash: r.postTxHash,
      settleTxHash: r.settleTxHash,
      error: r.error,
      createdAt: r.createdAt,
    })),
  }
}

/**
 * Dispatches the actual solve — inserts the agentTask row and calls the
 * runtime — under `dispatcherUserId`'s own session/BYOK. This is the one
 * piece of startVerifiedTask that MUST run as the solver's own owner: it's
 * their agent doing real work, billed (if BYOK) to their own key. Shared by
 * the same-user immediate path and acceptVerifiedTaskProposal() below so
 * the two can never drift.
 */
async function dispatchSolve(dispatcherUserId: string, solverAgentId: string, problem: string) {
  const agentTaskId = `task-${nanoid(10)}`
  await db.insert(agentTask).values({
    id: agentTaskId,
    userId: dispatcherUserId,
    agentId: solverAgentId,
    task: problem,
    status: 'running',
  })

  const { resolveUserAnthropicKey } = await import('@/lib/user-keys')
  const apiKey = await resolveUserAnthropicKey(dispatcherUserId)

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  await startAgentTask({
    agentId: solverAgentId,
    taskId: agentTaskId,
    task: problemPrompt(problem),
    callbackUrl: `${proto}://${host}/api/runtime/callback`,
    apiKey,
  })

  return agentTaskId
}

/**
 * Start a verified task end-to-end:
 *  1. generate problem + hidden answer (grader ≠ solver)
 *  2. escrow the bounty on-chain (requester's smart account)
 *  3a. same owner for both agents: kick the solve immediately (as before)
 *  3b. different owners: PROPOSE instead — see the cross-user note below
 * Settlement happens in the runtime callback once the solve returns.
 *
 * Cross-user note: dispatching a solve means running someone's agent and
 * (if they're on BYOK) billing their own API key for it. Doing that
 * unilaterally on behalf of a solver owned by a DIFFERENT user would be
 * commanding another user's agent without their consent — a real
 * authorization gap, not a limitation of the verification method itself
 * (grader ≠ solver already holds regardless of who owns what). So when the
 * solver belongs to someone else, this escrows the bounty (the requester's
 * own money, no permission issue there) and sends a `verified_task_proposal`
 * agent message instead of dispatching directly — the solver's own owner
 * calls acceptVerifiedTaskProposal() to actually kick the solve, under
 * their own session.
 */
export async function startVerifiedTask(input: {
  solverAgentId: string
  requesterAgentId: string
  difficulty: Difficulty
  bountyUsd: number
}) {
  const userId = await requireUser()
  const requester = await requireOwnedAgent(input.requesterAgentId, userId)
  const [solver] = await db.select().from(agent).where(eq(agent.id, input.solverAgentId))
  if (!solver) throw new Error('Solver agent not found')
  if (!solver.smartAccountAddress || !requester.smartAccountAddress) {
    throw new Error('Both agents need provisioned smart accounts')
  }
  if (solver.id === requester.id) throw new Error('Solver and requester must differ')
  if (!Number.isFinite(input.bountyUsd) || input.bountyUsd <= 0) throw new Error('Bounty must be positive')

  const { isVerifiedEscrowConfigured } = await import('@/lib/onchain/config')
  if (!isVerifiedEscrowConfigured()) throw new Error('Verified escrow not configured')

  const spec = generateProblem(input.difficulty)
  const salt = `0x${randomBytes(32).toString('hex')}` as `0x${string}`
  const crossUser = solver.userId !== userId

  const id = nanoid()
  await db.insert(verifiableTask).values({
    id,
    userId,
    solverAgentId: solver.id,
    requesterAgentId: requester.id,
    difficulty: spec.difficulty,
    problem: spec.problem,
    answer: spec.answer,
    salt,
    bountyUsd: input.bountyUsd.toString(),
    status: 'posting',
  })

  try {
    // Escrow on-chain: specHash commits to the problem, answerHash to the truth.
    const { keccak256, toHex } = await import('viem')
    const { postVerifiedTask, answerHashOf } = await import('@/lib/onchain/verified')
    const { txHash, taskId: onchainId } = await postVerifiedTask(
      requester.id,
      input.bountyUsd,
      0, // minScore 0: the solver is chosen explicitly here, gating is for open markets
      keccak256(toHex(spec.problem)),
      answerHashOf(spec.answer),
    )

    if (crossUser) {
      await db
        .update(verifiableTask)
        .set({ onchainId, postTxHash: txHash, status: 'awaiting_solver', updatedAt: new Date() })
        .where(eq(verifiableTask.id, id))

      const { sendAgentMessage } = await import('@/lib/agent-messages')
      await sendAgentMessage({
        fromAgentId: requester.id,
        toAgentId: solver.id,
        type: 'verified_task_proposal',
        body: `Proving Ground challenge — solve this and earn $${input.bountyUsd}, graded independently (not self-scored). Accept or decline from your Verified Tasks page.`,
        payload: {
          verifiable_task_id: id,
          difficulty: spec.difficulty,
          problem: spec.problem,
          bounty_usd: input.bountyUsd,
        },
      })

      revalidatePath('/verify')
      return { id, onchainId, postTxHash: txHash, awaitingSolver: true }
    }

    // Same owner for both agents — kick the solve immediately, as before.
    const agentTaskId = await dispatchSolve(userId, solver.id, spec.problem)
    await db
      .update(verifiableTask)
      .set({ onchainId, agentTaskId, postTxHash: txHash, status: 'solving', updatedAt: new Date() })
      .where(eq(verifiableTask.id, id))

    revalidatePath('/verify')
    return { id, onchainId, postTxHash: txHash }
  } catch (error) {
    throw asActionError(error, 'startVerifiedTask')
  }
}

/**
 * The solver's OWN owner accepts a cross-user proposal — this is what
 * actually kicks the solve, under their own session/BYOK, closing the
 * authorization gap noted on startVerifiedTask above.
 */
export async function acceptVerifiedTaskProposal(verifiableTaskId: string) {
  const userId = await requireUser()
  const [row] = await db.select().from(verifiableTask).where(eq(verifiableTask.id, verifiableTaskId))
  if (!row) throw new Error('Task not found')
  const solver = await requireOwnedAgent(row.solverAgentId, userId)
  if (row.status !== 'awaiting_solver') throw new Error('This proposal is no longer awaiting a response')

  try {
    const agentTaskId = await dispatchSolve(userId, solver.id, row.problem)
    await db
      .update(verifiableTask)
      .set({ agentTaskId, status: 'solving', updatedAt: new Date() })
      .where(eq(verifiableTask.id, row.id))

    const { sendAgentMessage } = await import('@/lib/agent-messages')
    await sendAgentMessage({
      fromAgentId: solver.id,
      toAgentId: row.requesterAgentId,
      type: 'job_proposal_accept',
      body: 'Accepted — solving now.',
      payload: { ref_message_id: verifiableTaskId },
    }).catch(() => {}) // courtesy notification only; never block the real accept on this

    revalidatePath('/verify')
    revalidatePath('/messages')
    return { agentTaskId }
  } catch (error) {
    throw asActionError(error, 'acceptVerifiedTaskProposal')
  }
}

/**
 * The solver's owner declines — refunds the requester's escrow immediately
 * (it's still on-chain "Open", never committed) rather than leaving it
 * locked until the requester notices and reclaims manually.
 */
export async function rejectVerifiedTaskProposal(verifiableTaskId: string) {
  const userId = await requireUser()
  const [row] = await db.select().from(verifiableTask).where(eq(verifiableTask.id, verifiableTaskId))
  if (!row) throw new Error('Task not found')
  await requireOwnedAgent(row.solverAgentId, userId)
  if (row.status !== 'awaiting_solver') throw new Error('This proposal is no longer awaiting a response')

  let txHash: string | null = null
  try {
    if (row.onchainId) {
      const { cancelVerifiedTask } = await import('@/lib/onchain/verified')
      txHash = await cancelVerifiedTask(row.requesterAgentId, row.onchainId)
    }
  } catch (error) {
    console.error('[verified] escrow reclaim on decline failed (requester can still reclaim manually):', error)
  }

  await db
    .update(verifiableTask)
    .set({
      status: 'declined',
      error: txHash ? `Declined by solver — escrow refunded (${txHash.slice(0, 10)}…)` : 'Declined by solver',
      updatedAt: new Date(),
    })
    .where(eq(verifiableTask.id, row.id))

  const { sendAgentMessage } = await import('@/lib/agent-messages')
  await sendAgentMessage({
    fromAgentId: row.solverAgentId,
    toAgentId: row.requesterAgentId,
    type: 'job_proposal_reject',
    body: 'Declined.',
    payload: { ref_message_id: verifiableTaskId },
  }).catch(() => {})

  revalidatePath('/verify')
  revalidatePath('/messages')
  return { txHash }
}

/** Reclaim escrow from a task whose solve failed (on-chain task still Open). */
export async function reclaimVerifiedTask(id: string) {
  const userId = await requireUser()
  const [row] = await db.select().from(verifiableTask).where(eq(verifiableTask.id, id))
  if (!row || row.userId !== userId) throw new Error('Task not found')
  // 'declined' covers the rare case where rejectVerifiedTaskProposal's own
  // best-effort refund attempt failed — the requester can still retry here.
  if (!['failed', 'declined'].includes(row.status) || !row.onchainId) throw new Error('Nothing to reclaim')

  let txHash: string
  try {
    const { cancelVerifiedTask } = await import('@/lib/onchain/verified')
    txHash = await cancelVerifiedTask(row.requesterAgentId, row.onchainId)
  } catch (error) {
    throw asActionError(error, 'reclaimVerifiedTask')
  }

  await db
    .update(verifiableTask)
    .set({ status: 'error', error: `escrow reclaimed (${txHash.slice(0, 10)}…)`, updatedAt: new Date() })
    .where(eq(verifiableTask.id, id))

  revalidatePath('/verify')
  return { txHash }
}
