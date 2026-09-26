import { describe, expect, it } from 'vitest'
import { normalizeClawhubSkill } from '@/lib/clawhub'

describe('normalizeClawhubSkill', () => {
  it('maps a real-shaped ClawHub item', () => {
    const s = normalizeClawhubSkill({
      slug: 'structured-pr-review',
      displayName: 'Structured PR Review',
      summary: 'Layered PR code review.',
      description: 'longer text',
      topics: ['github', 'code-review'],
      tags: { latest: '0.1.1' },
      stats: { downloads: 1021, installs: 15, stars: 2, versions: 2 },
      updatedAt: 1784776434493,
      latestVersion: { version: '0.1.1' },
    })
    expect(s).toEqual({
      slug: 'structured-pr-review',
      name: 'Structured PR Review',
      summary: 'Layered PR code review.',
      topics: ['github', 'code-review'],
      version: '0.1.1',
      downloads: 1021,
      installs: 15,
      stars: 2,
      updatedAt: 1784776434493,
      url: 'https://clawhub.ai/skills/structured-pr-review',
    })
  })

  it('falls back to slug for name and description for summary', () => {
    const s = normalizeClawhubSkill({ slug: 'x', description: 'desc only' })
    expect(s?.name).toBe('x')
    expect(s?.summary).toBe('desc only')
    expect(s?.version).toBeNull()
    expect(s?.downloads).toBe(0)
  })

  it('prefers latestVersion.version, then tags.latest', () => {
    expect(normalizeClawhubSkill({ slug: 'a', tags: { latest: '2.0.0' } })?.version).toBe('2.0.0')
    expect(
      normalizeClawhubSkill({ slug: 'a', tags: { latest: '2.0.0' }, latestVersion: { version: '3.0.0' } })?.version,
    ).toBe('3.0.0')
  })

  it('rejects items without a slug', () => {
    expect(normalizeClawhubSkill({ displayName: 'no slug' })).toBeNull()
    expect(normalizeClawhubSkill(null)).toBeNull()
    expect(normalizeClawhubSkill('nope')).toBeNull()
  })

  it('drops non-string topics defensively', () => {
    const s = normalizeClawhubSkill({ slug: 'a', topics: ['ok', 3, null, 'fine'] })
    expect(s?.topics).toEqual(['ok', 'fine'])
  })
})
