/**
 * Keeping the house requester agent solvent.
 *
 * Every dogfood posting path (i18n, docs, test suites, repo jobs) escrows a
 * real bounty from one house wallet. When that wallet runs dry, each post
 * fails deep inside an ERC-4337 simulation with `USDC: balance` — which
 * reads like a platform outage rather than "the wallet is empty".
 *
 * Testnet MockUSDC is freely mintable by design (`contracts/src/MockUSDC.sol`
 * — "Anyone may mint on testnet"), so a top-up costs nothing and needs no
 * approval. Pre-funding before a batch is therefore strictly better than
 * discovering the shortfall one reverted job at a time.
 *
 * This is NOT fake data: the escrow it funds is real on-chain testnet value
 * moving for real work, exactly like the mint_test_usdc tool users already
 * call for their own agents.
 */
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/** Mint in round chunks so a batch of small jobs doesn't mint 12 times. */
export const HOUSE_TOPUP_CHUNK_USD = 100

/** How much to mint to cover `neededUsd`, given the current balance. Returns
 *  0 when the wallet already covers it. Pure — the arithmetic is the part
 *  worth pinning down. */
export function topUpAmountUsd(balanceUsd: number, neededUsd: number, chunk = HOUSE_TOPUP_CHUNK_USD): number {
  const shortfall = neededUsd - balanceUsd
  if (shortfall <= 0) return 0
  return Math.ceil(shortfall / chunk) * chunk
}

export type HouseFunding = {
  address: string | null
  balanceUsd: number | null
  minted: number
  note: string
}

/** Current test-USDC balance of the house requester wallet. */
export async function houseBalanceUsd(houseAgentId: string): Promise<{ address: string | null; balanceUsd: number | null }> {
  const [house] = await db.select({ smartAccountAddress: agent.smartAccountAddress }).from(agent).where(eq(agent.id, houseAgentId))
  const address = house?.smartAccountAddress ?? null
  if (!address) return { address: null, balanceUsd: null }
  try {
    const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
    return { address, balanceUsd: await usdcBalanceOf(address as `0x${string}`) }
  } catch {
    return { address, balanceUsd: null }
  }
}

/**
 * Make sure the house wallet can cover `neededUsd` of escrow, minting free
 * testnet USDC if it can't. Best-effort: a mint failure is reported, not
 * thrown, so the caller still attempts the posts (and gets the real revert
 * if the wallet is genuinely stuck).
 */
export async function ensureHouseFunds(houseAgentId: string, neededUsd: number): Promise<HouseFunding> {
  const { address, balanceUsd } = await houseBalanceUsd(houseAgentId)
  if (!address) return { address: null, balanceUsd: null, minted: 0, note: 'House requester agent has no wallet.' }
  if (balanceUsd === null) {
    return { address, balanceUsd: null, minted: 0, note: 'Could not read the house wallet balance — posting anyway.' }
  }

  const amount = topUpAmountUsd(balanceUsd, neededUsd)
  if (amount === 0) {
    return { address, balanceUsd, minted: 0, note: `House wallet holds $${balanceUsd.toFixed(2)} — enough for $${neededUsd}.` }
  }

  try {
    const { mintTestUsdc } = await import('@/lib/onchain/treasury')
    await mintTestUsdc(houseAgentId, amount, address as `0x${string}`)
    const after = await houseBalanceUsd(houseAgentId)
    const { logPlatformEvent } = await import('@/lib/platform-feed')
    await logPlatformEvent(
      'HOUSE_WALLET_TOPPED_UP',
      `House requester topped up with $${amount} test USDC to cover $${neededUsd} of escrow`,
    ).catch(() => {})
    return {
      address,
      balanceUsd: after.balanceUsd ?? balanceUsd + amount,
      minted: amount,
      note: `House wallet held $${balanceUsd.toFixed(2)}, needed $${neededUsd} — minted $${amount} test USDC.`,
    }
  } catch (error) {
    const { explainOnchainError } = await import('@/lib/onchain/errors')
    return {
      address,
      balanceUsd,
      minted: 0,
      note: `House wallet holds $${balanceUsd.toFixed(2)} but needs $${neededUsd}, and the top-up failed: ${explainOnchainError(error)}`,
    }
  }
}
