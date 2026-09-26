import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_POST_GLOBAL_PER_DAY,
  EXTERNAL_POST_PER_PAYER_PER_DAY,
  UNATTRIBUTED_PAYER,
  externalPostAllowed,
  utcDayStart,
} from '@/lib/external-post-limits'

/**
 * The endpoint these guard is behind an x402 paywall, which is exactly why
 * it had no limit: a price felt like protection. It isn't — $0.10 buys a $25
 * house-escrowed bounty, so spending more is what an abuser wants to do.
 */
describe('externalPostAllowed', () => {
  it('allows a first post', () => {
    expect(externalPostAllowed({ payerToday: 0, globalToday: 0 })).toEqual({ ok: true })
  })

  it('stops one payer monopolising the board', () => {
    const at = externalPostAllowed({ payerToday: EXTERNAL_POST_PER_PAYER_PER_DAY, globalToday: 0 })
    expect(at.ok).toBe(false)
    if (!at.ok) expect(at.scope).toBe('payer')
  })

  it('stops many payers draining the house', () => {
    const at = externalPostAllowed({ payerToday: 0, globalToday: EXTERNAL_POST_GLOBAL_PER_DAY })
    expect(at.ok).toBe(false)
    if (!at.ok) expect(at.scope).toBe('global')
  })

  it('reports the global limit first — it is the one that breaks other people', () => {
    const at = externalPostAllowed({
      payerToday: EXTERNAL_POST_PER_PAYER_PER_DAY,
      globalToday: EXTERNAL_POST_GLOBAL_PER_DAY,
    })
    expect(at.ok).toBe(false)
    if (!at.ok) expect(at.scope).toBe('global')
  })

  it('is still allowed one below each cap', () => {
    expect(
      externalPostAllowed({
        payerToday: EXTERNAL_POST_PER_PAYER_PER_DAY - 1,
        globalToday: EXTERNAL_POST_GLOBAL_PER_DAY - 1,
      }),
    ).toEqual({ ok: true })
  })

  it('the per-payer cap is well below the global one, or it protects nothing', () => {
    expect(EXTERNAL_POST_PER_PAYER_PER_DAY).toBeLessThan(EXTERNAL_POST_GLOBAL_PER_DAY)
  })
})

describe('attribution', () => {
  it('unreadable payers share one bucket rather than getting a free one', () => {
    // The row is written with this key too, so an unattributable post counts.
    expect(UNATTRIBUTED_PAYER).toBe('unattributed')
    expect(UNATTRIBUTED_PAYER).not.toMatch(/^0x/) // can never collide with a real address
  })
})

describe('utcDayStart', () => {
  it('resets on the UTC day, matching the faucet cap', () => {
    const d = utcDayStart(new Date('2026-07-27T23:59:59.999Z'))
    expect(d.toISOString()).toBe('2026-07-27T00:00:00.000Z')
  })

  it('does not mutate its argument', () => {
    const now = new Date('2026-07-27T12:00:00.000Z')
    utcDayStart(now)
    expect(now.toISOString()).toBe('2026-07-27T12:00:00.000Z')
  })
})
