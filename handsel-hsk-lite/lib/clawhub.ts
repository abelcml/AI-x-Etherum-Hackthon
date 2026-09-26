/**
 * ClawHub (OpenClaw's skill registry) read client.
 *
 * ClawHub is the one OpenClaw-side catalog that's actually queryable — but it
 * lists *skills* (capabilities/extensions), NOT runnable agents. So we surface
 * it as an ecosystem **capability directory** ("what agents in this ecosystem
 * can do"), honestly framed — discovery, not hireable workers. See
 * docs/external-agents.md.
 *
 * Public read endpoints need no token; we cache and back off rather than poll
 * (per ClawHub's guidance), and link every entry back to its canonical
 * clawhub.ai page.
 */

const CLAWHUB_BASE = 'https://clawhub.ai'
const CACHE_TTL_MS = 10 * 60 * 1000

export interface ClawhubSkill {
  slug: string
  name: string
  summary: string
  topics: string[]
  version: string | null
  downloads: number
  installs: number
  stars: number
  updatedAt: number | null
  /** Canonical ClawHub page. clawhub.ai/skills/<slug> 307-redirects to the
   *  owner/slug page, so we don't need the owner (absent from the list API). */
  url: string
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Map one raw ClawHub API item to our clean shape. Pure + defensive — the
 *  registry may add/rename fields, and we never want a missing key to throw. */
export function normalizeClawhubSkill(raw: unknown): ClawhubSkill | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const slug = typeof r.slug === 'string' ? r.slug : null
  if (!slug) return null
  const stats = (r.stats ?? {}) as Record<string, unknown>
  const tags = (r.tags ?? {}) as Record<string, unknown>
  const latestVersion = (r.latestVersion ?? {}) as Record<string, unknown>
  return {
    slug,
    name: typeof r.displayName === 'string' && r.displayName ? r.displayName : slug,
    summary: typeof r.summary === 'string' ? r.summary : typeof r.description === 'string' ? r.description : '',
    topics: Array.isArray(r.topics) ? r.topics.filter((t): t is string => typeof t === 'string') : [],
    version:
      (typeof latestVersion.version === 'string' && latestVersion.version) ||
      (typeof tags.latest === 'string' && tags.latest) ||
      null,
    downloads: num(stats.downloads),
    installs: num(stats.installs),
    stars: num(stats.stars),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : null,
    url: `${CLAWHUB_BASE}/skills/${encodeURIComponent(slug)}`,
  }
}

let cache: { at: number; skills: ClawhubSkill[] } | null = null

/**
 * List skills from ClawHub, newest-first, normalized. Cached in-memory for 10
 * minutes; on any error (network, 429) returns the last good cache if present,
 * else an empty list — a degraded directory beats a crashed page.
 */
export async function listClawhubSkills(opts: { limit?: number } = {}): Promise<ClawhubSkill[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 60, 100))
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.skills.slice(0, limit)

  try {
    const res = await fetch(`${CLAWHUB_BASE}/api/v1/skills?limit=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`ClawHub responded ${res.status}`)
    const data = (await res.json()) as { items?: unknown[] }
    const items = Array.isArray(data.items) ? data.items : []
    const skills = items.map(normalizeClawhubSkill).filter((s): s is ClawhubSkill => s !== null)
    cache = { at: Date.now(), skills }
    return skills
  } catch (error) {
    console.error('[clawhub] list failed:', error)
    return cache?.skills.slice(0, limit) ?? []
  }
}
