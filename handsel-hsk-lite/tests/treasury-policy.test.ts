/**
 * Spending-cap regression tests. The env-parsing cases are not
 * hypothetical: production once had WALLET_DAILY_CAP_USD present-but-blank,
 * Number('') === 0 made the effective policy "$0/day", and every
 * withdrawal failed with "Daily transfer cap reached" from the first
 * attempt. These tests pin the fix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function loadPolicy(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const key of ['WALLET_MAX_TX_USD', 'WALLET_DAILY_CAP_USD', 'WALLET_CAP_HARD_MAX_USD']) {
    delete process.env[key]
  }
  Object.assign(process.env, env)
  return import('@/lib/treasury-policy')
}

describe('env cap parsing', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('uses defaults when unset', async () => {
    const p = await loadPolicy({})
    expect(p.WALLET_MAX_TX_USD).toBe(100)
    expect(p.WALLET_DAILY_CAP_USD).toBe(500)
  })

  it('treats an EMPTY env var as unset, not as $0 (the production incident)', async () => {
    const p = await loadPolicy({ WALLET_DAILY_CAP_USD: '' })
    expect(p.WALLET_DAILY_CAP_USD).toBe(500)
  })

  it('treats zero and negative caps as unset — a $0 cap is never sane config', async () => {
    const p = await loadPolicy({ WALLET_DAILY_CAP_USD: '0', WALLET_MAX_TX_USD: '-5' })
    expect(p.WALLET_DAILY_CAP_USD).toBe(500)
    expect(p.WALLET_MAX_TX_USD).toBe(100)
  })

  it('treats non-numeric caps as unset', async () => {
    const p = await loadPolicy({ WALLET_MAX_TX_USD: 'banana' })
    expect(p.WALLET_MAX_TX_USD).toBe(100)
  })

  it('accepts valid positive caps', async () => {
    const p = await loadPolicy({ WALLET_MAX_TX_USD: '1000', WALLET_DAILY_CAP_USD: '5000' })
    expect(p.WALLET_MAX_TX_USD).toBe(1000)
    expect(p.WALLET_DAILY_CAP_USD).toBe(5000)
  })
})

describe('policyForUserRow (per-account overrides)', () => {
  it('falls back to platform defaults when the user set nothing', async () => {
    const p = await loadPolicy({})
    expect(p.policyForUserRow(undefined)).toEqual({ maxPerTxUsd: 100, dailyCapUsd: 500 })
    expect(p.policyForUserRow({ walletMaxTxUsd: null, walletDailyCapUsd: null })).toEqual({
      maxPerTxUsd: 100,
      dailyCapUsd: 500,
    })
  })

  it('uses the user values when set', async () => {
    const p = await loadPolicy({})
    expect(p.policyForUserRow({ walletMaxTxUsd: '250.00', walletDailyCapUsd: '2000.00' })).toEqual({
      maxPerTxUsd: 250,
      dailyCapUsd: 2000,
    })
  })

  it('clamps user values to the hard platform ceiling', async () => {
    const p = await loadPolicy({ WALLET_CAP_HARD_MAX_USD: '10000' })
    expect(p.policyForUserRow({ walletMaxTxUsd: '999999', walletDailyCapUsd: '999999' })).toEqual({
      maxPerTxUsd: 10000,
      dailyCapUsd: 10000,
    })
  })

  it('ignores zero/negative/garbage user values', async () => {
    const p = await loadPolicy({})
    expect(p.policyForUserRow({ walletMaxTxUsd: '0', walletDailyCapUsd: 'NaN' })).toEqual({
      maxPerTxUsd: 100,
      dailyCapUsd: 500,
    })
  })
})
