'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/admin'
import { getEffectiveCreditRules, isCreditRulesCustomized, replaceCreditRules } from '@/lib/credit-rules'
import { RATINGS, RISK_LEVELS, DEFAULT_RATING_RULES, DEFAULT_RISK_RULES } from '@/lib/credit-engine/scoring'
import { asActionError } from '@/lib/action-error'

export async function getCreditRatingPolicy() {
  await requirePermission('credit_rules')
  const [rules, customized] = await Promise.all([getEffectiveCreditRules(), isCreditRulesCustomized()])
  return {
    rating: rules.rating,
    risk: rules.risk,
    customized,
    validRatings: RATINGS,
    validRiskLevels: RISK_LEVELS,
    defaultRating: DEFAULT_RATING_RULES,
    defaultRisk: DEFAULT_RISK_RULES,
  }
}

function validateRows(kind: 'rating' | 'risk_level', rows: { minScore: number; value: string }[], valid: readonly string[]) {
  if (rows.length === 0) return // empty = revert to shipped defaults
  const seen = new Set<number>()
  for (const r of rows) {
    if (!Number.isFinite(r.minScore) || r.minScore < 0 || r.minScore > 990) {
      throw new Error(`${kind}: minScore must be between 0 and 990`)
    }
    if (seen.has(r.minScore)) throw new Error(`${kind}: duplicate minScore ${r.minScore}`)
    seen.add(r.minScore)
    if (!valid.includes(r.value)) throw new Error(`${kind}: "${r.value}" is not a valid value`)
  }
}

export async function updateCreditRatingPolicy(
  rating: { minScore: number; value: string }[],
  risk: { minScore: number; value: string }[],
) {
  const me = await requirePermission('credit_rules')

  try {
    validateRows('rating', rating, RATINGS)
    validateRows('risk_level', risk, RISK_LEVELS)

    await replaceCreditRules('rating', rating, me.id)
    await replaceCreditRules('risk_level', risk, me.id)

    revalidatePath('/admin/credit-rules')
  } catch (error) {
    throw asActionError(error, 'updateCreditRatingPolicy')
  }
}

/** Delete all overrides for both tables — back to the shipped defaults. */
export async function resetCreditRatingPolicy() {
  const me = await requirePermission('credit_rules')
  await replaceCreditRules('rating', [], me.id)
  await replaceCreditRules('risk_level', [], me.id)
  revalidatePath('/admin/credit-rules')
}
