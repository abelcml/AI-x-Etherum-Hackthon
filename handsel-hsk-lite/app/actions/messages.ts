'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { dmThread, dmMessage, user } from '@/lib/db/schema'
import { and, desc, eq, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { SAFE_USER_COLUMNS } from '@/lib/db/safe-select'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user
}

/** Canonical (userA, userB) ordering so a pair always maps to one thread. */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

async function requireParticipant(threadId: string, userId: string) {
  const [thread] = await db.select().from(dmThread).where(eq(dmThread.id, threadId))
  if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
    throw new Error('Conversation not found')
  }
  return thread
}

/** Get or create the thread with another user, identified by email. */
export async function startConversationByEmail(email: string) {
  const me = await requireUser()
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) throw new Error('Email required')

  const [other] = await db.select(SAFE_USER_COLUMNS).from(user).where(eq(user.email, trimmed))
  if (!other) throw new Error('No user found with that email')
  if (other.id === me.id) throw new Error("That's you")

  return startConversationByUserId(other.id)
}

/** Get or create the thread with another user, identified by user id. */
export async function startConversationByUserId(otherUserId: string) {
  const me = await requireUser()
  if (otherUserId === me.id) throw new Error("That's you")

  const [userAId, userBId] = orderPair(me.id, otherUserId)
  const [existing] = await db
    .select()
    .from(dmThread)
    .where(and(eq(dmThread.userAId, userAId), eq(dmThread.userBId, userBId)))
  if (existing) return { id: existing.id }

  const id = nanoid()
  await db.insert(dmThread).values({ id, userAId, userBId })
  return { id }
}

/** All of the current user's conversations, newest activity first, with the
 *  other participant's display name and a preview of the last message. */
export async function getThreads() {
  const me = await requireUser()
  const threads = await db
    .select()
    .from(dmThread)
    .where(or(eq(dmThread.userAId, me.id), eq(dmThread.userBId, me.id)))
    .orderBy(desc(dmThread.updatedAt))

  return Promise.all(
    threads.map(async (t) => {
      const otherId = t.userAId === me.id ? t.userBId : t.userAId
      const [other] = await db.select(SAFE_USER_COLUMNS).from(user).where(eq(user.id, otherId))
      const [last] = await db
        .select()
        .from(dmMessage)
        .where(eq(dmMessage.threadId, t.id))
        .orderBy(desc(dmMessage.createdAt))
        .limit(1)
      return {
        id: t.id,
        otherUser: { id: otherId, name: other?.name ?? null, email: other?.email ?? 'Unknown' },
        lastMessage: last ? { body: last.body, mine: last.senderId === me.id, createdAt: last.createdAt } : null,
        updatedAt: t.updatedAt,
      }
    }),
  )
}

export async function getMessages(threadId: string) {
  const me = await requireUser()
  await requireParticipant(threadId, me.id)

  const rows = await db
    .select()
    .from(dmMessage)
    .where(eq(dmMessage.threadId, threadId))
    .orderBy(dmMessage.createdAt)
  return rows.map((m) => ({ id: m.id, body: m.body, mine: m.senderId === me.id, createdAt: m.createdAt }))
}

export async function sendMessage(threadId: string, body: string) {
  const me = await requireUser()
  await requireParticipant(threadId, me.id)
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Message is empty')
  if (trimmed.length > 4000) throw new Error('Message too long')

  await db.insert(dmMessage).values({ id: nanoid(), threadId, senderId: me.id, body: trimmed })
  await db.update(dmThread).set({ updatedAt: new Date() }).where(eq(dmThread.id, threadId))
  revalidatePath('/messages')
  return { ok: true }
}
