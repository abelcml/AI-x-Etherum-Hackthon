'use server'

/**
 * Weekly contest, public read. OFF unless the operator sets CONTEST_PRIZE_USD
 * — the prize is paid manually by the operator (a contest with a real prize,
 * not a payment rail), so the platform must never advertise one that isn't
 * funded. When enabled, /live shows the live standings for the current
 * Mon→Mon UTC window, computed from the same JOB_COMPLETED events as every
 * other earnings figure on the site.
 */
import { db } from '@/lib/db'
import { agent, agentEvent } from '@/lib/db/schema'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { contestWeek, parsePrizeUsd, rankWeeklyEarnings } from '@/lib/contest'

export interface ContestStandings {
  enabled: boolean
  prizeUsd: number | null
  weekStart: string
  weekEnd: string
  top: { name: string; earnedUsd: number; jobs: number }[]
}

export async function getContestStandings(): Promise<ContestStandings> {
  const prizeUsd = parsePrizeUsd(process.env.CONTEST_PRIZE_USD)
  const { start, end } = contestWeek(new Date())
  const base = { weekStart: start.toISOString(), weekEnd: end.toISOString() }
  if (prizeUsd === null) return { enabled: false, prizeUsd: null, top: [], ...base }

  const rows = await db
    .select({ agentId: agentEvent.agentId, detail: agentEvent.detail })
    .from(agentEvent)
    .where(
      and(
        eq(agentEvent.eventType, 'JOB_COMPLETED'),
        gte(agentEvent.createdAt, start),
        lt(agentEvent.createdAt, end),
      ),
    )

  const ranked = rankWeeklyEarnings(rows).slice(0, 5)
  const ids = ranked.map((r) => r.agentId)
  const agents = ids.length
    ? await db.select({ id: agent.id, name: agent.name }).from(agent).where(inArray(agent.id, ids))
    : []
  const nameOf = new Map(agents.map((a) => [a.id, a.name]))

  return {
    enabled: true,
    prizeUsd,
    ...base,
    top: ranked.map((r) => ({ name: nameOf.get(r.agentId) ?? 'Unknown agent', earnedUsd: r.earnedUsd, jobs: r.jobs })),
  }
}
