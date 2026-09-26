/**
 * Durable credential-attempt throttle — a DB-backed sliding window that
 * (unlike the in-memory lib/rate-limit.ts) survives Vercel's serverless
 * fan-out: every lambda queries the same `auth_attempts` table, so a
 * burst spread across cold instances is still counted as one. This is the
 * hard backstop against credential stuffing on the unauthenticated auth
 * endpoints, on top of bcrypt's per-attempt cost.
 *
 * Fail-open by design: if the DB read/write itself errors (e.g. table not
 * migrated yet), we let the request through rather than locking everyone
 * out — availability of sign-in beats a throttle that could brick login.
 */
import { db } from '@/lib/db'
import { authAttempt } from '@/lib/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export type AuthScope = 'signin' | 'register' | 'personal-token' | 'withdraw'

export interface ThrottleConfig {
  windowMs: number
  max: number
}

const DEFAULTS: Record<AuthScope, ThrottleConfig> = {
  signin: { windowMs: 10 * 60 * 1000, max: 20 },
  register: { windowMs: 10 * 60 * 1000, max: 5 },
  'personal-token': { windowMs: 10 * 60 * 1000, max: 10 },
  // Tightest of the four: this scope takes a password AND moves funds on
  // success, so a guess here is worth more to an attacker than a sign-in.
  withdraw: { windowMs: 10 * 60 * 1000, max: 8 },
}

/** Best-effort client IP from proxy headers. */
export function throttleIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Record this attempt and report whether the caller is now OVER the limit.
 * One INSERT + one COUNT per call; stale rows for this (scope, ip) are
 * pruned in the same round trip. Returns false (allowed) on any DB error.
 */
export async function authThrottled(scope: AuthScope, ip: string, cfg = DEFAULTS[scope]): Promise<boolean> {
  const since = new Date(Date.now() - cfg.windowMs)
  try {
    // Prune this key's stale rows so the table can't grow unbounded.
    await db.delete(authAttempt).where(and(eq(authAttempt.scope, scope), eq(authAttempt.ip, ip), sql`${authAttempt.at} < ${since}`))
    await db.insert(authAttempt).values({ id: nanoid(), scope, ip })
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authAttempt)
      .where(and(eq(authAttempt.scope, scope), eq(authAttempt.ip, ip), gte(authAttempt.at, since)))
    return count > cfg.max
  } catch (error) {
    console.error(`[auth-throttle] ${scope} check failed (allowing):`, error)
    return false
  }
}
