'use server'

import { getSession } from '@/lib/get-session'
import { revalidatePath } from 'next/cache'
import {
  govSummary,
  createLock,
  createProposal,
  castVote,
  listProposals,
  listVotingAgents,
  setAutoVote,
  listPendingReviews,
  resolveDelegateReview,
  type VoteChoice,
} from '@/lib/governance'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getGovernance() {
  const userId = await requireUser()
  const [summary, proposals, agents, reviews] = await Promise.all([
    govSummary(userId),
    listProposals(userId),
    listVotingAgents(userId),
    listPendingReviews(userId),
  ])
  return { summary, proposals, agents, reviews }
}

export async function resolveReview(proposalId: string, action: 'accept' | 'dismiss') {
  const userId = await requireUser()
  try {
    const r = await resolveDelegateReview(userId, proposalId, action)
    revalidatePath('/governance')
    return r
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setAgentAutoVote(agentId: string, enabled: boolean, policy: string) {
  const userId = await requireUser()
  try {
    await setAutoVote(agentId, userId, enabled, policy)
    revalidatePath('/governance')
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function lockLedger(amount: number, weeks: number) {
  const userId = await requireUser()
  try {
    await createLock(userId, amount, weeks)
    revalidatePath('/governance')
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function openProposal(title: string, body: string) {
  const userId = await requireUser()
  try {
    const r = await createProposal(userId, title, body)
    revalidatePath('/governance')
    return { ok: true as const, id: r.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function voteOnProposal(proposalId: string, choice: VoteChoice) {
  const userId = await requireUser()
  try {
    const r = await castVote(userId, proposalId, choice)
    revalidatePath('/governance')
    return { ok: true as const, power: r.power }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
