'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { randomBytes } from 'node:crypto'

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getAgents() {
  const userId = await getUserId()
  return db
    .select()
    .from(agent)
    .where(eq(agent.userId, userId))
    .orderBy(desc(agent.createdAt))
}

export async function getAgentById(agentId: string) {
  const userId = await getUserId()
  const result = await db
    .select()
    .from(agent)
    .where(eq(agent.id, agentId))
  if (result.length === 0 || result[0].userId !== userId) {
    throw new Error('Agent not found or unauthorized')
  }
  return result[0]
}

/**
 * Bootstraps a single agent on first login — with a genuine cold-start
 * state (score 0, rating 'unrated'), not seeded placeholder numbers. The
 * credit engine only assigns a real score once the agent has behavioral
 * history (a task run, a repayment, a completed job). The wallet address
 * is just an internal identifier until the owner provisions a real
 * on-chain smart account from the profile page.
 */
export async function bootstrapFirstAgent() {
  const userId = await getUserId()
  const existing = await db.select().from(agent).where(eq(agent.userId, userId))
  if (existing.length > 0) return { created: false }

  const agentId = nanoid()
  await db.insert(agent).values({
    id: agentId,
    userId,
    name: 'My Research Agent',
    walletAddress: `0x${randomBytes(20).toString('hex')}`,
    description: 'Provision an on-chain smart account and run your first task to start building credit.',
    modelVersion: 'claude-sonnet-5',
    creditScore: '0',
    creditRating: 'unrated',
    riskLevel: 'UNKNOWN',
    riskRating: 'unrated',
    totalCreditLine: '0',
    availableCredit: '0',
  })

  // Per-agent key from birth — no worker ever runs on the shared secret.
  await (await import('@/lib/agent-keys')).ensureAgentKey(agentId)

  revalidatePath('/')
  revalidatePath('/agents')
  return { created: true, id: agentId }
}

/**
 * Create a new agent, at a genuine cold start — same shape as
 * bootstrapFirstAgent. No wallet address is asked of the user; it's just
 * an internal placeholder until an on-chain smart account is provisioned
 * from the profile page.
 */
export async function createAgent(data: { name: string; description?: string }) {
  const userId = await getUserId()
  const name = data.name.trim()
  if (!name) throw new Error('Name required')

  // Unique per account — duplicate names made requester-by-name lookups
  // sign with the wrong wallet (the NotRequester incident), so the name
  // must resolve to exactly one agent within an account.
  const [dupe] = await db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.userId, userId), eq(agent.name, name)))
  if (dupe) throw new Error(`You already have an agent named "${name}" — pick a different name`)

  const agentId = nanoid()
  await db.insert(agent).values({
    id: agentId,
    userId,
    name,
    walletAddress: `0x${randomBytes(20).toString('hex')}`,
    description: data.description?.trim() || null,
    modelVersion: 'claude-sonnet-5',
    creditScore: '0',
    creditRating: 'unrated',
    riskLevel: 'UNKNOWN',
    riskRating: 'unrated',
    totalCreditLine: '0',
    availableCredit: '0',
  })

  // Per-agent key from birth — no worker ever runs on the shared secret.
  await (await import('@/lib/agent-keys')).ensureAgentKey(agentId)

  revalidatePath('/')
  revalidatePath('/agents')
  return { id: agentId }
}

export async function updateAgent(
  agentId: string,
  data: Partial<{ name: string; description: string }>
) {
  const userId = await getUserId()
  const existing = await db
    .select()
    .from(agent)
    .where(eq(agent.id, agentId))
  if (existing.length === 0 || existing[0].userId !== userId) {
    throw new Error('Agent not found or unauthorized')
  }

  await db.update(agent).set(data).where(eq(agent.id, agentId))
  revalidatePath('/agents')
  revalidatePath('/profile')
}
