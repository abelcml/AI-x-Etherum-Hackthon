'use server'

import { getSession } from '@/lib/get-session'
import { revalidatePath } from 'next/cache'
import { asActionError } from '@/lib/action-error'
import { isSuperAdminEmail, listGrants, grantPermission, revokePermission, PERMISSIONS, type Permission } from '@/lib/admin'

async function requireSuperAdmin() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  if (!isSuperAdminEmail(session.user.email)) throw new Error('Superadmin access required')
  return session.user
}

export async function getAccessMatrix() {
  await requireSuperAdmin()
  return { permissions: PERMISSIONS as unknown as Permission[], grants: await listGrants() }
}

export async function grantAccess(email: string, permission: Permission) {
  const me = await requireSuperAdmin()
  if (!PERMISSIONS.includes(permission)) throw new Error('Unknown permission')

  try {
    await grantPermission(email.trim().toLowerCase(), permission, me.id)
    revalidatePath('/admin/access')
  } catch (error) {
    throw asActionError(error, 'grantAccess')
  }
}

export async function revokeAccess(userId: string, permission: Permission) {
  await requireSuperAdmin()
  await revokePermission(userId, permission)
  revalidatePath('/admin/access')
}
