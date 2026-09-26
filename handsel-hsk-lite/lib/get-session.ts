import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { session, user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Selects only the columns this hot path actually needs, instead of
 * drizzle's relational query API (`db.query.user.findFirst`) — which
 * SELECTs every column declared in schema.ts regardless of what's really
 * in the database. That mismatch isn't hypothetical: it already took down
 * every login and every session check in production the moment a new
 * `user` column (payoutAddress) shipped ahead of its migration, because
 * this exact query started asking for a column Postgres didn't have yet.
 * Selecting explicitly means a future schema addition can only break the
 * features that use the new column — never the login/session path itself.
 */
export async function getSession() {
  try {
    const c = await cookies()
    const sessionId = c.get('auth_session')?.value

    if (!sessionId) return null

    const [sess] = await db
      .select({ id: session.id, userId: session.userId, expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.id, sessionId))

    if (!sess || new Date(sess.expiresAt) < new Date()) return null

    const [u] = await db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, sess.userId))

    if (!u) return null

    return {
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
      },
      session: sess,
    }
  } catch (e) {
    console.error('[v0] Failed to get session:', e)
    return null
  }
}
