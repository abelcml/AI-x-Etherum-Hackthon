import {
  DEFAULT_VAULT,
  availableToDrawUsd,
  collateralValueUsd,
  healthFactor,
  isLiquidatable,
  maxDebtUsd,
  previewDraw,
  previewLiquidation,
  type Position,
  type VaultParams,
} from '@/lib/mini-vault'

/**
 * MiniVault simulator — the GIWA MiniDAI flow (collateral → stable debt →
 * oracle price → health factor → liquidation) as a public, stateless
 * endpoint. Pure math, no funds: post a position and a price, optionally a
 * draw or a liquidation, and get every number the lab teaches back.
 *
 *   POST /api/vault/simulate
 *   { "collateralUnits": 2, "priceUsd": 1800, "debtUsd": 1500,
 *     "drawUsd"?: 100, "liquidate"?: { "repayUsd": 500, "gasCostUsd"?: 3 },
 *     "params"?: { mcr, liqRatio, closeFactor, liquidationBonus } }
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  let body: {
    collateralUnits?: number
    priceUsd?: number
    debtUsd?: number
    drawUsd?: number
    liquidate?: { repayUsd?: number; gasCostUsd?: number }
    params?: Partial<VaultParams>
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const collateralUnits = Number(body.collateralUnits)
  const priceUsd = Number(body.priceUsd)
  const debtUsd = Number(body.debtUsd ?? 0)
  if (!Number.isFinite(collateralUnits) || collateralUnits < 0 || !Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(debtUsd) || debtUsd < 0) {
    return Response.json({ error: 'need collateralUnits ≥ 0, priceUsd > 0, debtUsd ≥ 0' }, { status: 400 })
  }

  const params: VaultParams = { ...DEFAULT_VAULT, ...(body.params ?? {}) }
  const pos: Position = { collateralUnits, debtUsd }
  const hf = healthFactor(pos, priceUsd, params)

  return Response.json({
    params,
    position: pos,
    priceUsd,
    collateralValueUsd: collateralValueUsd(pos, priceUsd),
    maxDebtUsd: maxDebtUsd(pos, priceUsd, params),
    availableToDrawUsd: availableToDrawUsd(pos, priceUsd, params),
    healthFactor: Number.isFinite(hf) ? Math.round(hf * 1000) / 1000 : null,
    liquidatable: isLiquidatable(pos, priceUsd, params),
    draw: body.drawUsd != null ? previewDraw(pos, priceUsd, Number(body.drawUsd), params) : undefined,
    liquidation:
      body.liquidate != null
        ? previewLiquidation(pos, priceUsd, Number(body.liquidate.repayUsd), params, Number(body.liquidate.gasCostUsd ?? 0))
        : undefined,
  })
}
