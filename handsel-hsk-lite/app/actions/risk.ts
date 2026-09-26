'use server'

/**
 * Risk Analytics — real portfolio-level aggregation over the user's own
 * agents. No invented statistics: every figure here is either a direct sum
 * of real DB columns or a plain count/share, honestly labeled as such. In
 * particular this deliberately does NOT show a "default probability %" or
 * a "VaR (95%)" — both are real actuarial/statistical concepts that need a
 * return-series or a calibrated default model we don't have; showing a
 * confident-looking number for either would be exactly the kind of
 * fabricated precision this project has removed everywhere else. What we
 * DO have — real credit lines, real ratings, real risk levels from the
 * scoring engine — is what's shown here.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { Rating, RiskLevel } from '@/lib/credit-engine/scoring'

const RATING_BANDS: (Rating | 'unrated')[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D', 'unrated']
const RISK_LEVELS: (RiskLevel | 'UNKNOWN')[] = ['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'UNKNOWN']

export async function getRiskAnalytics() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  const agents = await db.select().from(agent).where(eq(agent.userId, session.user.id))

  const totalExposure = agents.reduce((sum, a) => sum + parseFloat(a.totalCreditLine ?? '0'), 0)
  const activeCreditLines = agents.filter((a) => parseFloat(a.totalCreditLine ?? '0') > 0).length

  const ratingCounts = new Map<string, number>()
  const riskLevelCounts = new Map<string, number>()
  let elevatedOrHighOutstanding = 0

  for (const a of agents) {
    const rating = a.creditRating ?? 'unrated'
    ratingCounts.set(rating, (ratingCounts.get(rating) ?? 0) + 1)

    const riskLevel = a.riskLevel ?? 'UNKNOWN'
    riskLevelCounts.set(riskLevel, (riskLevelCounts.get(riskLevel) ?? 0) + 1)

    if (riskLevel === 'ELEVATED' || riskLevel === 'HIGH') {
      const outstanding = parseFloat(a.totalCreditLine ?? '0') - parseFloat(a.availableCredit ?? '0')
      elevatedOrHighOutstanding += Math.max(0, outstanding)
    }
  }

  const total = agents.length
  const aaaShare = total > 0 ? (ratingCounts.get('AAA') ?? 0) / total : null

  return {
    hasAgents: total > 0,
    agentCount: total,
    totalExposure,
    activeCreditLines,
    aaaShare,
    // Real, exactly-defined figure: outstanding (drawn, unrepaid) credit
    // held specifically by agents the scoring engine already rates
    // ELEVATED or HIGH risk. Not a VaR — no distributional assumption, no
    // confidence interval — just "how much of what's currently owed sits
    // with the riskier half of the portfolio."
    elevatedOrHighOutstanding,
    ratingDistribution: RATING_BANDS.map((band) => ({
      band,
      count: ratingCounts.get(band) ?? 0,
      share: total > 0 ? (ratingCounts.get(band) ?? 0) / total : 0,
    })).filter((r) => r.count > 0),
    riskLevelDistribution: RISK_LEVELS.map((level) => ({
      level,
      count: riskLevelCounts.get(level) ?? 0,
      share: total > 0 ? (riskLevelCounts.get(level) ?? 0) / total : 0,
    })).filter((r) => r.count > 0),
  }
}
