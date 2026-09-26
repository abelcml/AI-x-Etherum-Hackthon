import { miniVaultAddress, readMiniVaultPosition, readMiniVaultState } from '@/lib/onchain/mini-vault-chain'
import { healthFactor, isLiquidatable, DEFAULT_VAULT, type Position } from '@/lib/mini-vault'
import { oracleAccount } from '@/lib/onchain/clients'

/**
 * Public, keyless read of the LIVE MiniVault contract — plus a cross-check:
 * the same numbers recomputed by the pure TS engine (lib/mini-vault.ts). The
 * contract and the engine share parameters, so `engineAgrees: true` is a
 * standing proof that the on-chain math matches the unit-tested math.
 *
 *   GET /api/vault/onchain[?user=0x…]
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const address = await miniVaultAddress()
  if (!address) return Response.json({ deployed: false })

  const state = await readMiniVaultState()
  const url = new URL(request.url)
  // Default to the oracle's own demo position so keyless viewers (the /world
  // gauge card) always have a live position to render.
  let user = url.searchParams.get('user')
  if (!user) {
    try {
      user = oracleAccount().address
    } catch {
      /* no oracle configured */
    }
  }
  let position = null
  let crossCheck = null
  if (user && /^0x[0-9a-fA-F]{40}$/.test(user) && state) {
    position = await readMiniVaultPosition(user as `0x${string}`)
    if (position) {
      const pos: Position = { collateralUnits: position.collateralEth, debtUsd: position.debtGusd }
      const engineHf = healthFactor(pos, state.priceUsd, DEFAULT_VAULT)
      const engineLiq = isLiquidatable(pos, state.priceUsd, DEFAULT_VAULT)
      const hfAgrees =
        position.healthFactor === null ? engineHf === Infinity : Math.abs(engineHf - position.healthFactor) < 1e-6
      crossCheck = { engineHealthFactor: Number.isFinite(engineHf) ? engineHf : null, engineLiquidatable: engineLiq, engineAgrees: hfAgrees && engineLiq === position.liquidatable }
    }
  }
  return Response.json({ deployed: true, chain: 'sepolia', state, user, position, crossCheck })
}
