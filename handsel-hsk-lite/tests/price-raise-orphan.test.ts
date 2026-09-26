import { describe, it, expect } from 'vitest'
import { isOrphanedRaise } from '@/lib/price-raise'

const now = new Date('2026-07-26T15:00:00Z')
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000)
const plan = { ceilingUsd: 20, stepUsd: 5, stepMinutes: 60, pendingUsd: 10 }

// A raise cancels the old escrow and posts a replacement. Dying in between
// used to mean: money refunded, work gone, no trace to resume from.

describe('isOrphanedRaise', () => {
  const row = (over = {}) => ({
    parentSpecHash: '0xparent',
    pricing: plan,
    onchainJobId: null as number | null,
    createdAt: minsAgo(30),
    ...over,
  })

  it('spots a replacement row that never reached the chain', () => {
    expect(isOrphanedRaise(now, row())).toBe(true)
  })

  it('leaves a raise that is merely in flight alone', () => {
    expect(isOrphanedRaise(now, row({ createdAt: minsAgo(1) }))).toBe(false)
  })

  it('ignores rows that did get posted', () => {
    expect(isOrphanedRaise(now, row({ onchainJobId: 42 }))).toBe(false)
  })

  it('ignores original postings — only replacements have a parent', () => {
    expect(isOrphanedRaise(now, row({ parentSpecHash: null }))).toBe(false)
  })

  it('ignores rows with no price plan at all', () => {
    expect(isOrphanedRaise(now, row({ pricing: null }))).toBe(false)
  })
})
