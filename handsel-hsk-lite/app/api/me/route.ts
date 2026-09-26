import { getSession } from '@/lib/get-session'

export async function GET() {
  const session = await getSession()

  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return Response.json({ user: session.user })
}
