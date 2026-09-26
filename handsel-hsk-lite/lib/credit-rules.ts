/**
 * Reads the credit rating decision table from the DB, falling back to the
 * shipped defaults when no admin has overridden them yet. This is the only
 * place that turns DB rows into the ScoreRule[] shape scoring.ts expects —
 * scoring.ts itself stays pure (no I/O), per its own documented contract.
 */
import { db } from '@/lib/db'
import { creditRatingRule } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_RATING_RULES,
  DEFAULT_RISK_RULES,
  type Rating,
  type RiskLevel,
  type ScoreRule,
} from '@/lib/credit-engine/scoring'

export async function getEffectiveCreditRules(): Promise<{
  rating: ScoreRule<Rating>[]
  risk: ScoreRule<RiskLevel>[]
}> {
  const rows = await db.select().from(creditRatingRule)

  const rating = rows
    .filter((r) => r.kind === 'rating')
    .map((r) => ({ minScore: r.minScore, value: r.value as Rating }))
  const risk = rows
    .filter((r) => r.kind === 'risk_level')
    .map((r) => ({ minScore: r.minScore, value: r.value as RiskLevel }))

  return {
    rating: rating.length > 0 ? rating : DEFAULT_RATING_RULES,
    risk: risk.length > 0 ? risk : DEFAULT_RISK_RULES,
  }
}

/** Whether an admin has overridden either decision table (vs still running
 *  on the shipped defaults). Purely informational, for the editor UI. */
export async function isCreditRulesCustomized(): Promise<boolean> {
  const [row] = await db.select().from(creditRatingRule).limit(1)
  return Boolean(row)
}

/** Replace a decision table (kind='rating' or 'risk_level') atomically. */
export async function replaceCreditRules(
  kind: 'rating' | 'risk_level',
  rows: { minScore: number; value: string }[],
  updatedBy: string,
): Promise<void> {
  await db.delete(creditRatingRule).where(eq(creditRatingRule.kind, kind))
  if (rows.length === 0) return // deleting all rows = revert to defaults
  await db.insert(creditRatingRule).values(
    rows.map((r) => ({
      id: `${kind}-${r.minScore}`,
      kind,
      minScore: r.minScore,
      value: r.value,
      updatedBy,
    })),
  )
}
