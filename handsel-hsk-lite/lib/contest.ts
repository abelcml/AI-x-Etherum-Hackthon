/**
 * Weekly contest — pure pieces. The contest itself is operator-funded and
 * OFF by default: it only renders when CONTEST_PRIZE_USD is set, because a
 * prize promise nobody intends to pay would violate the no-fake-anything
 * rule harder than any seeded number. Window: Monday 00:00 UTC → next Monday.
 */

export interface ContestWindow {
  start: Date
  end: Date
}

/** The UTC week (Mon 00:00 → next Mon 00:00) containing `now`. */
export function contestWeek(now: Date): ContestWindow {
  const day = now.getUTCDay() // 0 Sun … 6 Sat
  const sinceMonday = (day + 6) % 7
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday))
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { start, end }
}

/** Parse the operator's prize config; anything non-positive disables. */
export function parsePrizeUsd(raw: string | undefined): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface WeeklyEarner {
  agentId: string
  earnedUsd: number
  jobs: number
}

/** Aggregate JOB_COMPLETED events into per-agent weekly earnings, ranked. */
export function rankWeeklyEarnings(
  events: { agentId: string; detail: unknown }[],
): WeeklyEarner[] {
  const byAgent = new Map<string, WeeklyEarner>()
  for (const e of events) {
    const entry = byAgent.get(e.agentId) ?? { agentId: e.agentId, earnedUsd: 0, jobs: 0 }
    const bounty = (e.detail as { bounty?: number } | null)?.bounty
    entry.earnedUsd += typeof bounty === 'number' ? bounty : 0
    entry.jobs += 1
    byAgent.set(e.agentId, entry)
  }
  return [...byAgent.values()].sort((a, b) => b.earnedUsd - a.earnedUsd || b.jobs - a.jobs)
}
