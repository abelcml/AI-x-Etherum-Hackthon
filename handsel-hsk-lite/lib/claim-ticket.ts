/**
 * One-time claim tickets — borrowed from the EAS Ticketing lab's `used` mapping.
 *
 * The lab's lesson: a ticket must be single-use — once redeemed it cannot be
 * replayed (the resolver writes to a `used` mapping, becoming non-view). We use
 * the same idea to make job claims idempotent: a job can be *held* by exactly
 * one worker, and a held claim can be *redeemed* (submitted) exactly once —
 * blocking double-claim races and re-submission replays without touching chain.
 *
 * `UsedTickets` is the pure state machine (fully unit-testable). The exported
 * functions back the same semantics with a self-migrating Postgres table where
 * the PRIMARY KEY on job_ref gives an atomic "first claim wins".
 */
import { pool } from '@/lib/db'

export type ClaimResult = { won: boolean; holder: string }

/** Pure, in-memory model of the one-time claim semantics (used mapping). */
export class UsedTickets {
  private held = new Map<string, string>()
  private redeemed = new Set<string>()

  /** First caller to open a jobRef wins; later callers see the current holder. */
  open(jobRef: string, agent: string): ClaimResult {
    const existing = this.held.get(jobRef)
    if (existing) return { won: existing === agent, holder: existing }
    this.held.set(jobRef, agent)
    return { won: true, holder: agent }
  }

  /** Redeem (submit) once: only the holder, and only if not already redeemed. */
  redeem(jobRef: string, agent: string): boolean {
    if (this.held.get(jobRef) !== agent) return false
    if (this.redeemed.has(jobRef)) return false
    this.redeemed.add(jobRef)
    return true
  }

  isRedeemed(jobRef: string): boolean {
    return this.redeemed.has(jobRef)
  }

  /** Free the slot (e.g. a job is reposted after failing grading). */
  release(jobRef: string): void {
    this.held.delete(jobRef)
    this.redeemed.delete(jobRef)
  }
}

async function ensureTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS claim_tickets (
       job_ref text PRIMARY KEY,
       holder text NOT NULL,
       redeemed boolean NOT NULL DEFAULT false,
       created_at timestamptz NOT NULL DEFAULT now(),
       redeemed_at timestamptz
     )`,
  )
}

/** Atomic "first claim wins": INSERT .. ON CONFLICT DO NOTHING. Returns whether
 *  this caller now holds the job, and who the holder is. */
export async function openClaim(jobRef: string, agent: string): Promise<ClaimResult> {
  await ensureTable()
  const ins = await pool.query(
    `INSERT INTO claim_tickets (job_ref, holder) VALUES ($1, $2)
     ON CONFLICT (job_ref) DO NOTHING`,
    [jobRef, agent],
  )
  if ((ins.rowCount ?? 0) > 0) return { won: true, holder: agent }
  const { rows } = await pool.query<{ holder: string }>(`SELECT holder FROM claim_tickets WHERE job_ref = $1`, [jobRef])
  return { won: false, holder: rows[0]?.holder ?? agent }
}

/** Redeem once — only the holder, only if not already redeemed. */
export async function redeemClaim(jobRef: string, agent: string): Promise<boolean> {
  await ensureTable()
  const res = await pool.query(
    `UPDATE claim_tickets SET redeemed = true, redeemed_at = now()
     WHERE job_ref = $1 AND holder = $2 AND redeemed = false`,
    [jobRef, agent],
  )
  return (res.rowCount ?? 0) > 0
}

export async function releaseClaim(jobRef: string): Promise<void> {
  try {
    await ensureTable()
    await pool.query(`DELETE FROM claim_tickets WHERE job_ref = $1`, [jobRef])
  } catch {
    /* best-effort */
  }
}
