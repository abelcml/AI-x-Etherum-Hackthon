/**
 * Spending policy for autonomous wallet control.
 *
 * The agent (Claude, mid-reasoning) may move real funds, so every transfer —
 * agent-initiated or manual — passes these checks, and every executed
 * transfer lands in the behavioral ledger as a WALLET_TRANSFER event. The
 * daily cap is computed from that ledger, so the ledger is also the enforcer.
 *
 * Caps are sized PER ACCOUNT: the platform env values are only the default
 * for accounts that never touched their settings. The caps protect the
 * owner's funds from a runaway/compromised agent, so the owner sets them
 * (Worker Console → payout settings), bounded by a hard platform ceiling so
 * "I typed 9 nine times" can't disable the guard entirely.
 */
import { db } from '@/lib/db'
import { agent, agentEvent, user } from '@/lib/db/schema'
import { and, eq, gte } from 'drizzle-orm'

/** An env cap must be a positive number to count — an EMPTY env var
 *  (present in Vercel but blank) coerces to 0 via Number(''), which
 *  silently turned the daily cap into "$0/day, every withdrawal blocked
 *  from the first attempt" in production. A cap of 0 is never a sane
 *  configuration (freeze transfers by other means), so <= 0 and NaN both
 *  fall back to the default. */
function envCap(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const WALLET_MAX_TX_USD = envCap('WALLET_MAX_TX_USD', 100)
export const WALLET_DAILY_CAP_USD = envCap('WALLET_DAILY_CAP_USD', 500)

/** Absolute ceiling a user-set cap may reach, whatever they type. */
export const WALLET_CAP_HARD_MAX_USD = envCap('WALLET_CAP_HARD_MAX_USD', 100_000)

export interface SpendingPolicy {
  maxPerTxUsd: number
  dailyCapUsd: number
}

function normalizeCap(raw: string | null | undefined, fallback: number): number {
  const n = raw == null ? NaN : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, WALLET_CAP_HARD_MAX_USD)
}

/** The caps that apply to this USER (their own settings, else platform defaults). */
export function policyForUserRow(row: { walletMaxTxUsd: string | null; walletDailyCapUsd: string | null } | undefined): SpendingPolicy {
  return {
    maxPerTxUsd: normalizeCap(row?.walletMaxTxUsd, WALLET_MAX_TX_USD),
    dailyCapUsd: normalizeCap(row?.walletDailyCapUsd, WALLET_DAILY_CAP_USD),
  }
}

/** The caps that apply to this AGENT — resolved through its owning user. */
export async function policyForAgent(agentId: string): Promise<SpendingPolicy> {
  try {
    const [row] = await db
      .select({ walletMaxTxUsd: user.walletMaxTxUsd, walletDailyCapUsd: user.walletDailyCapUsd })
      .from(agent)
      .innerJoin(user, eq(agent.userId, user.id))
      .where(eq(agent.id, agentId))
    return policyForUserRow(row)
  } catch (error) {
    // Deployed ahead of its migration the columns don't exist yet — fall
    // back to platform defaults instead of blocking every transfer (same
    // failure mode that once took down sign-in; see /api/signin).
    console.error('[treasury-policy] per-user cap lookup failed (migration pending?):', error)
    return { maxPerTxUsd: WALLET_MAX_TX_USD, dailyCapUsd: WALLET_DAILY_CAP_USD }
  }
}

export function isValidAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

/** Sum of transfers in the last 24h, read from the event ledger. */
export async function spentLast24h(agentId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  // `detail` only: a bare select asks for every agent_events column, so a
  // column shipped ahead of its migration would break EVERY withdrawal.
  const rows = await db
    .select({ detail: agentEvent.detail })
    .from(agentEvent)
    .where(
      and(
        eq(agentEvent.agentId, agentId),
        eq(agentEvent.eventType, 'WALLET_TRANSFER'),
        gte(agentEvent.createdAt, since),
      ),
    )
  return rows.reduce((sum, e) => sum + (Number((e.detail as any)?.amountUsd) || 0), 0)
}

/** Throws with a human-readable reason when the transfer violates policy. */
export async function enforceSpendingPolicy(agentId: string, amountUsd: number): Promise<void> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Amount must be positive')
  const policy = await policyForAgent(agentId)
  if (amountUsd > policy.maxPerTxUsd) {
    throw new Error(`Per-transfer cap is $${policy.maxPerTxUsd} (requested $${amountUsd}) — raise it in Worker Console payout settings`)
  }
  const spent = await spentLast24h(agentId)
  if (spent + amountUsd > policy.dailyCapUsd) {
    throw new Error(
      `Daily cap $${policy.dailyCapUsd} would be exceeded (spent $${spent.toFixed(2)} in 24h) — raise it in Worker Console payout settings`,
    )
  }
}
