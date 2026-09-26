'use server'

/**
 * Account self-management — the "my page" basics a real service owes its
 * users: change display name, change password. Deliberately small: no
 * email change (email is the login identifier and we have no verification
 * flow to make changing it safe) and no self-serve deletion yet (agents
 * own on-chain state; deletion semantics need design, tracked in README's
 * known gaps).
 */
import bcrypt from 'bcryptjs'
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { user, session as sessionTable } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { asActionError } from '@/lib/action-error'
import { SAFE_USER_COLUMNS } from '@/lib/db/safe-select'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session
}

export async function updateDisplayName(name: string) {
  const session = await requireUser()
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 60) throw new Error('Name must be 1–60 characters')

  try {
    await db.update(user).set({ name: trimmed, updatedAt: new Date() }).where(eq(user.id, session.user.id))
    return { name: trimmed }
  } catch (error) {
    throw asActionError(error, 'updateDisplayName')
  }
}

/** Change password: verifies the current one first, then signs out every
 *  OTHER session — the standard containment move if a password leaked. */
export async function changePassword(currentPassword: string, newPassword: string) {
  const session = await requireUser()
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters')

  try {
    const [row] = await db.select(SAFE_USER_COLUMNS).from(user).where(eq(user.id, session.user.id))
    if (!row?.password) throw new Error('Account has no password set')
    const ok = await bcrypt.compare(currentPassword, row.password)
    if (!ok) throw new Error('Current password is incorrect')

    const hashed = await bcrypt.hash(newPassword, 10)
    await db.update(user).set({ password: hashed, updatedAt: new Date() }).where(eq(user.id, session.user.id))

    await db
      .delete(sessionTable)
      .where(and(eq(sessionTable.userId, session.user.id), ne(sessionTable.id, session.session.id)))

    return { ok: true }
  } catch (error) {
    throw asActionError(error, 'changePassword')
  }
}
