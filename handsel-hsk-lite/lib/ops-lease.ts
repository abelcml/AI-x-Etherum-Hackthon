/**
 * Cross-instance lease for background work.
 *
 * Every sweep in this codebase throttles with a module-level timestamp,
 * which is per-lambda-instance — fine when one scheduler calls one
 * endpoint, useless the moment background work is driven by traffic,
 * because each concurrent instance has its own clock and they all think
 * they are due.
 *
 * This file used to claim the damage was only "wasted on-chain calls and
 * duplicate reverts rather than lost money." That was wrong once the money
 * paths started writing their intent down first. Two instances sweeping
 * price raises at the same moment both see the job Open, both insert a
 * replacement row, and only one cancel can win — the loser's row survives
 * as an orphan that `resumeOrphanedRaises` later posts, so the requester
 * ends up escrowing the same work twice. Idempotence per call does not
 * compose into idempotence under concurrency.
 *
 * So the sweeps that move money take a lease here instead of trusting a
 * timestamp that only one lambda can see.
 *
 * This is one atomic statement in Postgres: insert the lease, or steal it
 * only if the existing one has expired. Exactly one caller gets a row back.
 * Self-migrating like platform_secrets, so no migration gates the fix.
 */
import { pool } from '@/lib/db'

let tableReady: Promise<void> | null = null

function ensureTable(): Promise<void> {
  tableReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS ops_leases (
         name text PRIMARY KEY,
         leased_until timestamptz NOT NULL
       )`,
    )
    .then(() => undefined)
  return tableReady
}

/**
 * Try to take `name` for `ttlMs`. Returns true to exactly one caller until
 * the lease expires. Any failure returns false — a lease system that
 * fails OPEN would let every instance run at once, which is the situation
 * it exists to prevent.
 */
/**
 * Give a lease back early.
 *
 * A recurring sweep should just let its lease expire — that expiry *is* the
 * interval. This exists for the other use: a lease taken as a **mutex** around
 * one operation, where holding it after deciding not to act would block a
 * legitimate retry for the rest of the TTL. The bounty-label webhook needs
 * exactly that: it locks the issue before checking, and several of its checks
 * end in "tell the user how to fix this and stop" — which the user then fixes
 * and re-labels within seconds.
 *
 * Best-effort by design: a failed release is harmless (the lease expires), so
 * it must never fail the operation it is unwinding.
 */
export async function releaseOpsLease(name: string): Promise<void> {
  try {
    await ensureTable()
    await pool.query('DELETE FROM ops_leases WHERE name = $1', [name])
  } catch (error) {
    console.warn('[ops-lease] releasing', name, 'failed (it will expire):', error)
  }
}

export async function acquireOpsLease(name: string, ttlMs: number): Promise<boolean> {
  try {
    await ensureTable()
    const { rows } = await pool.query(
      `INSERT INTO ops_leases (name, leased_until)
       VALUES ($1, now() + make_interval(secs => $2))
       ON CONFLICT (name) DO UPDATE
         SET leased_until = EXCLUDED.leased_until
         WHERE ops_leases.leased_until < now()
       RETURNING name`,
      [name, Math.max(1, Math.round(ttlMs / 1000))],
    )
    return rows.length > 0
  } catch (error) {
    console.error('[ops-lease] acquiring', name, 'failed:', error)
    return false
  }
}
