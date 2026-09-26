import { getSession } from '@/lib/get-session'
import { isSuperAdminEmail } from '@/lib/admin'
import { pool } from '@/lib/db'
import { sql } from '@/scripts/migrate.mjs'

/**
 * POST /api/admin/migrate — runs the exact same idempotent schema migration
 * as `pnpm db:migrate`, but against the app's own DB connection (`lib/db`'s
 * pool, built from the same DATABASE_URL the running server actually uses).
 * Exists because a locally-run migration can silently target a different
 * database (different Neon branch/project) than what's deployed — this
 * removes that ambiguity entirely. Superadmin-only; safe to leave in place
 * since every statement is `IF NOT EXISTS`.
 */
export async function POST() {
  const session = await getSession()
  if (!isSuperAdminEmail(session?.user?.email)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await pool.query(sql)
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
