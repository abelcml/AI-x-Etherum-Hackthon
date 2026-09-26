'use server'

/**
 * Owner-driven side of agent-to-agent negotiation: a human viewing/using
 * their own agent's messages from the dashboard. The agent-runtime tool
 * and BYO-agent HTTP paths (app/api/agents/messages/*) go through the same
 * lib/agent-messages.ts core, so the rate limit and block list apply no
 * matter who's actually sending — a human clicking Send and an autonomous
 * agent calling the tool mid-task are the same call underneath.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentBlock, agentMessage } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/admin'
import {
  MESSAGE_TYPES,
  listAgentMessages,
  markAgentMessagesRead,
  sendAgentMessage,
  type AgentMessageType,
} from '@/lib/agent-messages'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return found
}

export async function sendAgentMessageAction(input: {
  fromAgentId: string
  toAgentId: string
  type: AgentMessageType
  body: string
  payload?: Record<string, unknown>
}) {
  await requireOwnedAgent(input.fromAgentId)
  if (!MESSAGE_TYPES.includes(input.type)) throw new Error('Unknown message type')

  const result = await sendAgentMessage(input)
  revalidatePath('/messages')
  return result
}

/** One row per counterpart this agent has ever exchanged a message with,
 *  newest activity first — the negotiation-inbox equivalent of getThreads(). */
export async function getAgentConversations(agentId: string) {
  await requireOwnedAgent(agentId)

  // listAgentMessages already returns newest-first, so the first time a
  // counterpart is seen while walking it IS their most recent message.
  const all = await listAgentMessages(agentId)

  const byCounterpart = new Map<string, (typeof all)[number]>()
  const unreadByCounterpart = new Map<string, number>()
  for (const m of all) {
    const counterpart = m.fromAgentId === agentId ? m.toAgentId : m.fromAgentId
    if (!byCounterpart.has(counterpart)) byCounterpart.set(counterpart, m)
    if (m.toAgentId === agentId && !m.readAt) {
      unreadByCounterpart.set(m.fromAgentId, (unreadByCounterpart.get(m.fromAgentId) ?? 0) + 1)
    }
  }

  const counterpartIds = [...byCounterpart.keys()]
  const counterparts =
    counterpartIds.length > 0 ? await db.select().from(agent).where(inArray(agent.id, counterpartIds)) : []
  const nameOf = new Map(counterparts.map((a) => [a.id, a]))

  return [...byCounterpart.entries()].map(([counterpartId, last]) => ({
    counterpartAgentId: counterpartId,
    counterpartName: nameOf.get(counterpartId)?.name ?? 'Unknown agent',
    lastMessage: { type: last.type, body: last.body, mine: last.fromAgentId === agentId, createdAt: last.createdAt },
    unread: unreadByCounterpart.get(counterpartId) ?? 0,
  }))
}

export async function getAgentConversation(agentId: string, counterpartAgentId: string) {
  await requireOwnedAgent(agentId)

  const rows = await db
    .select()
    .from(agentMessage)
    .where(
      and(
        inArray(agentMessage.fromAgentId, [agentId, counterpartAgentId]),
        inArray(agentMessage.toAgentId, [agentId, counterpartAgentId]),
      ),
    )
    .orderBy(agentMessage.createdAt)

  await markAgentMessagesRead(agentId, counterpartAgentId)
  revalidatePath('/messages')

  return rows.map((m) => ({
    id: m.id,
    type: m.type,
    body: m.body,
    payload: m.payload as Record<string, unknown>,
    mine: m.fromAgentId === agentId,
    createdAt: m.createdAt,
  }))
}

export async function blockAgent(agentId: string, blockedAgentId: string) {
  await requireOwnedAgent(agentId)
  await db
    .insert(agentBlock)
    .values({ blockerAgentId: agentId, blockedAgentId })
    .onConflictDoNothing()
  revalidatePath('/messages')
}

export async function unblockAgent(agentId: string, blockedAgentId: string) {
  await requireOwnedAgent(agentId)
  await db
    .delete(agentBlock)
    .where(and(eq(agentBlock.blockerAgentId, agentId), eq(agentBlock.blockedAgentId, blockedAgentId)))
  revalidatePath('/messages')
}

export async function getBlockedAgents(agentId: string) {
  await requireOwnedAgent(agentId)
  const blocks = await db.select().from(agentBlock).where(eq(agentBlock.blockerAgentId, agentId))
  const ids = blocks.map((b) => b.blockedAgentId)
  if (ids.length === 0) return []
  const agents = await db.select().from(agent).where(inArray(agent.id, ids))
  return agents.map((a) => ({ id: a.id, name: a.name }))
}

/**
 * Platform-wide moderation — distinct from blockAgent/unblockAgent above,
 * which is each recipient's own opt-out for themselves only. This is an
 * admin (holding the 'agent_messages' permission, see lib/admin.ts) muting
 * an abusive agent for every recipient at once; sendAgentMessage() checks
 * agent.messagingSuspended before anything else.
 */
export async function suspendAgentMessaging(agentId: string, reason?: string) {
  await requirePermission('agent_messages')
  await db
    .update(agent)
    .set({ messagingSuspended: true, messagingSuspendedReason: reason?.trim() || null, updatedAt: new Date() })
    .where(eq(agent.id, agentId))
  revalidatePath('/admin/access')
}

export async function unsuspendAgentMessaging(agentId: string) {
  await requirePermission('agent_messages')
  await db
    .update(agent)
    .set({ messagingSuspended: false, messagingSuspendedReason: null, updatedAt: new Date() })
    .where(eq(agent.id, agentId))
  revalidatePath('/admin/access')
}

/** All currently-suspended agents, for the moderation panel. */
export async function getSuspendedAgents() {
  await requirePermission('agent_messages')
  const rows = await db.select().from(agent).where(eq(agent.messagingSuspended, true))
  return rows.map((a) => ({ id: a.id, name: a.name, reason: a.messagingSuspendedReason }))
}
