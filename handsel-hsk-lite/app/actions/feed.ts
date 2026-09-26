'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { platformEvent } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

/** Recent cross-user activity — jobs, templates, verified tasks. Any
 *  logged-in user can see the platform-wide feed (no per-user filtering). */
export async function getPlatformFeed(limit = 20) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  const rows = await db.select().from(platformEvent).orderBy(desc(platformEvent.createdAt)).limit(limit)
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, createdAt: r.createdAt }))
}
