'use server'

/**
 * Posting GitHub repo jobs (docs/github-jobs.md, Phase 2).
 *
 * Kept out of app/actions/labor.ts because a repo job has a real precondition
 * the generic Post-a-Job form doesn't: the platform's GitHub App must actually
 * be installed on the repository, and the base branch must exist. Both are
 * checked HERE, before any escrow moves — a requester finding out at
 * settlement time that we can't open a PR is the worst possible moment.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

// Import the type; do NOT re-export it. Next treats every export of a
// 'use server' module as a server action and emits a runtime binding for it —
// a type-only export is erased by then, so the build fails with "Export
// RepoJobInput doesn't exist in target module". tsc cannot see this, because
// it is a Next transform rule rather than a TypeScript one. Consumers import
// the type from '@/lib/repo-job-post' directly.
import type { RepoJobInput } from '@/lib/repo-job-post'

/** Dogfood path: post a repo job from the platform's own house requester, so
 *  the operator can put THIS repo's real backlog on the board (same principle
 *  as the i18n/docs/test-suite dogfood sources — real work, real escrow). */
export async function postRepoJobAsHouse(input: Omit<RepoJobInput, 'requesterAgentId'>) {
  const session = await getSession()
  const { isSuperAdminEmail } = await import('@/lib/admin')
  if (!isSuperAdminEmail(session?.user?.email)) throw new Error('Superadmin access required')
  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID
  if (!houseAgentId) throw new Error('Set X402_JOB_REQUESTER_AGENT_ID (a provisioned, funded agent) first')
  const [house] = await db.select().from(agent).where(eq(agent.id, houseAgentId))
  if (!house?.smartAccountAddress) throw new Error('House requester agent is not provisioned')
  const { ensureHouseFunds } = await import('@/lib/house-funding')
  await ensureHouseFunds(houseAgentId, input.bountyUsd)
  const { postRepoJob } = await import('@/lib/repo-job-post')
  const result = await postRepoJob({ ...input, requesterAgentId: houseAgentId })
  revalidatePath('/jobs')
  return result
}

/**
 * The signed-in user's GitHub connection and the repositories they can post
 * jobs on — the intersection of "you can see it" and "our App is installed".
 * Everything the picker needs in one round trip, including where to go when
 * the answer is "nowhere yet".
 */
export async function getGithubConnection() {
  const session = await getSession()
  const { githubConnectionFor } = await import('@/lib/github-identity')
  return githubConnectionFor(session?.user?.id ?? null)
}

/** Unlink GitHub from the signed-in account (deletes the stored token). */
export async function disconnectGithubAction() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const { disconnectGithub } = await import('@/lib/github-identity')
  await disconnectGithub(session.user.id)
}

/** Is the App installed and the branch real? Returns a human-readable reason
 *  when not, so the UI/MCP can tell the requester exactly what to fix. */
export async function checkRepoAccess(repoFullName: string) {
  const { checkRepoAccess: check } = await import('@/lib/repo-job-post')
  return check(repoFullName)
}

/**
 * Post a repo job: escrow a bounty against a real repository task. The
 * worker's deliverable is a unified diff; the platform opens the PR; the
 * repository's own CI grades it; merging releases the escrow.
 */
export async function postRepoJobAction(input: RepoJobInput) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [ag] = await db.select().from(agent).where(eq(agent.id, input.requesterAgentId))
  if (!ag || ag.userId !== session.user.id) throw new Error('Agent not found')
  const { postRepoJob } = await import('@/lib/repo-job-post')
  const result = await postRepoJob(input)
  revalidatePath('/jobs')
  return result
}
