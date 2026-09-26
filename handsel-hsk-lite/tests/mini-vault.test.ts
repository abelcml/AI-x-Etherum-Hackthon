import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VAULT,
  availableToDrawUsd,
  getAmountOut,
  healthFactor,
  isLiquidatable,
  maxDebtUsd,
  previewDraw,
  previewLiquidation,
  spotPrice,
  type Position,
} from '@/lib/mini-vault'

// 2 units of collateral at $1800 → $3600 value. MCR 150% → max debt $2400.
const POS: Position = { collateralUnits: 2, debtUsd: 1500 }
const PRICE = 1800

describe('mini-vault: mint gate & health', () => {
  it('caps total debt at collateralValue / MCR', () => {
    expect(maxDebtUsd(POS, PRICE)).toBe(2400)
    expect(availableToDrawUsd(POS, PRICE)).toBe(900)
  })

  it('allows a draw within the gate and blocks one beyond it', () => {
    const ok = previewDraw(POS, PRICE, 900)
    expect(ok.ok).toBe(true)
    expect(ok.position.debtUsd).toBe(2400)

    const no = previewDraw(POS, PRICE, 901)
    expect(no.ok).toBe(false)
    expect(no.reason).toMatch(/exceed/)
  })

  it('debt-free position has infinite health and is never liquidatable', () => {
    const free: Position = { collateralUnits: 1, debtUsd: 0 }
    expect(healthFactor(free, PRICE)).toBe(Infinity)
    expect(isLiquidatable(free, PRICE)).toBe(false)
  })

  it('a price drop pushes HF below 1 → liquidatable (the oracle lesson)', () => {
    expect(healthFactor(POS, PRICE)).toBeCloseTo(2, 5) // 3600 / (1500*1.2)
    expect(isLiquidatable(POS, PRICE)).toBe(false)
    const crashed = 800 // value 1600 < 1500*1.2=1800
    expect(healthFactor(POS, crashed)).toBeLessThan(1)
    expect(isLiquidatable(POS, crashed)).toBe(true)
  })
})

describe('mini-vault: liquidation', () => {
  const crashedPrice = 800 // POS is under water here

  it('refuses to liquidate a healthy position', () => {
    const res = previewLiquidation(POS, PRICE, 500)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/healthy/)
  })

  it('caps repay at closeFactor × debt and seizes repay×(1+bonus)/price', () => {
    const res = previewLiquidation(POS, crashedPrice, 10_000) // ask for way too much
    expect(res.ok).toBe(true)
    expect(res.repaidUsd).toBe(1500 * DEFAULT_VAULT.closeFactor) // 750
    // seized = 750 * 1.1 / 800
    expect(res.seizedUnits).toBeCloseTo((750 * 1.1) / 800, 6)
    expect(res.position.debtUsd).toBe(750)
    // accounting: seized value ≈ repaid × (1+bonus)
    expect(res.seizedValueUsd).toBeCloseTo(750 * 1.1, 1)
  })

  it('liquidator profit = seized − repaid − gas (can go negative on high gas)', () => {
    const cheap = previewLiquidation(POS, crashedPrice, 750, DEFAULT_VAULT, 5)
    expect(cheap.liquidatorProfitUsd).toBeCloseTo(750 * 0.1 - 5, 1) // bonus − gas
    const gasHog = previewLiquidation(POS, crashedPrice, 750, DEFAULT_VAULT, 200)
    expect(gasHog.liquidatorProfitUsd).toBeLessThan(0) // the lab's "real profit" lesson
  })

  it('never seizes more collateral than the position holds', () => {
    const dust: Position = { collateralUnits: 0.1, debtUsd: 1500 }
    const res = previewLiquidation(dust, crashedPrice, 750)
    expect(res.ok).toBe(true)
    expect(res.seizedUnits).toBeLessThanOrEqual(0.1)
    expect(res.position.collateralUnits).toBeGreaterThanOrEqual(0)
  })
})

describe('mini-vault: AMM (constant product)', () => {
  it('preserves x·y ≥ k after a fee-bearing swap', () => {
    const [rIn, rOut] = [10_000, 5]
    const out = getAmountOut(1_000, rIn, rOut)
    expect(out).toBeGreaterThan(0)
    expect((rIn + 1_000) * (rOut - out)).toBeGreaterThanOrEqual(rIn * rOut) // fee accrues to LPs
  })

  it('bigger trades pay worse average prices (price impact)', () => {
    const small = getAmountOut(100, 10_000, 5) / 100
    const big = getAmountOut(5_000, 10_000, 5) / 5_000
    expect(big).toBeLessThan(small)
    expect(spotPrice(10_000, 5)).toBe(2_000)
  })
})
