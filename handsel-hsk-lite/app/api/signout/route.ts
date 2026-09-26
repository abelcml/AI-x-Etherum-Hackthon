import { db } from '@/lib/db'
import { session } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'

/**
 * POST /api/signout — invalidates the session server-side and clears the
 * cookie. Both steps matter: auth_session is httpOnly (correctly — it can't
 * be touched from client JS), so clearing it requires a server round trip;
 * deleting the session row also means the old session id can't be replayed
 * even if the cookie somehow survives on the client.
 */
export async function POST() {
  const c = await cookies()
  const sessionId = c.get('auth_session')?.value

  if (sessionId) {
    await db.delete(session).where(eq(session.id, sessionId)).catch(() => {})
  }
  c.delete('auth_session')

  return Response.json({ ok: true })
}
