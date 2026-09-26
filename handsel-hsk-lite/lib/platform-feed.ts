/**
 * Append-only platform activity feed — purely cosmetic, so a logging
 * failure must never break the real economic action it's attached to.
 */
import { db } from '@/lib/db'
import { platformEvent } from '@/lib/db/schema'
import { nanoid } from 'nanoid'

export async function logPlatformEvent(kind: string, summary: string): Promise<void> {
  try {
    await db.insert(platformEvent).values({ id: nanoid(), kind, summary })
  } catch (error) {
    console.error('[platform-feed] failed to log event (non-fatal):', error)
  }
}
