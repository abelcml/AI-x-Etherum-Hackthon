import { pool } from '@/lib/db'
import { nanoid } from 'nanoid'

/**
 * Public email capture for the try-it funnel. Self-migrating: creates the
 * demo_leads table on first use (IF NOT EXISTS) so this ships without a
 * separate migration step. Stores just enough to follow up with a lead.
 */
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request): Promise<Response> {
  let email: string, kind: string, prompt: string
  try {
    const body = await request.json()
    email = String(body?.email ?? '').trim().toLowerCase()
    kind = String(body?.kind ?? '').slice(0, 16)
    prompt = String(body?.prompt ?? '').slice(0, 500)
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return Response.json({ error: 'enter a valid email' }, { status: 400 })
  }

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS demo_leads (
         id text PRIMARY KEY,
         email text NOT NULL,
         kind text,
         prompt text,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    )
    await pool.query('INSERT INTO demo_leads (id, email, kind, prompt) VALUES ($1, $2, $3, $4)', [
      nanoid(),
      email,
      kind,
      prompt,
    ])
    return Response.json({ status: 'ok' })
  } catch (error) {
    console.error('[demo/lead] failed:', error)
    return Response.json({ error: 'could not save — try again' }, { status: 500 })
  }
}
