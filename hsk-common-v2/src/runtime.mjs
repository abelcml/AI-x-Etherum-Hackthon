import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const chain = defineChain({
  id: 133, name: 'HSK Chain Testnet', testnet: true,
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'HSK Testnet', url: 'https://testnet-explorer.hsk.xyz' } },
})

export function address(value, field) {
  try {
    if (!value || /^0x0{40}$/i.test(value)) throw new Error()
    return getAddress(value)
  } catch { throw new Error(`${field} must be a nonzero EVM address`) }
}

export function loadArtifacts() {
  try { return JSON.parse(readFileSync(new URL('../artifacts/contracts.json', import.meta.url), 'utf8')) }
  catch { throw new Error('Run pnpm compile first to generate contract artifacts') }
}

export function networkConfig(env = process.env) {
  if (env.ONCHAIN_CHAIN && env.ONCHAIN_CHAIN !== 'hsk-testnet') throw new Error('Only hsk-testnet (133) is supported')
  const rpc = env.ONCHAIN_RPC_URL || chain.rpcUrls.default.http[0]
  try {
    if (!['http:', 'https:'].includes(new URL(rpc).protocol)) throw new Error()
  } catch { throw new Error('ONCHAIN_RPC_URL must be an HTTP(S) endpoint') }
  return { chain, rpc }
}

export async function context(role, { contracts = true } = {}) {
  const { rpc } = networkConfig()
  const publicClient = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 10000 }) })
  let chainId
  try { chainId = await publicClient.getChainId() }
  catch { throw new Error('HSK RPC unavailable; no transaction sent') }
  if (chainId !== 133) throw new Error('RPC chain ID mismatch; expected 133, no transaction sent')
  const artifacts = loadArtifacts()
  const market = process.env.LABOR_MARKET_ADDRESS || null
  const token = process.env.USDC_ADDRESS || null
  const registry = process.env.CREDIT_REGISTRY_ADDRESS || null
  if (contracts) {
    for (const [name, value] of [['LABOR_MARKET_ADDRESS', market], ['USDC_ADDRESS', token], ['CREDIT_REGISTRY_ADDRESS', registry]]) {
      address(value, name)
      const code = await publicClient.getCode({ address: value })
      if (!code || code === '0x') throw new Error(`${name} has no code on HSK testnet`)
    }
    const decimals = await publicClient.readContract({ address: token, abi: artifacts.MockUSDC.abi, functionName: 'decimals' })
    if (Number(decimals) !== 6) throw new Error('USDC_ADDRESS must have 6 decimals')
    const [marketToken, marketRegistry] = await Promise.all([
      publicClient.readContract({ address: market, abi: artifacts.LaborMarketV2.abi, functionName: 'usdc' }),
      publicClient.readContract({ address: market, abi: artifacts.LaborMarketV2.abi, functionName: 'registry' }),
    ])
    if (marketToken.toLowerCase() !== token.toLowerCase() || marketRegistry.toLowerCase() !== registry.toLowerCase()) {
      throw new Error('Configured token/registry do not match the deployed market')
    }
  }
  let account = null
  let walletClient = null
  if (role !== undefined && role !== null) {
    if (!['deployer', 'requester', 'worker'].includes(role)) throw new Error('Invalid signing role')
    const keyName = `${role.toUpperCase()}_PRIVATE_KEY`
    const key = process.env[keyName]
    if (!key) throw new Error(`Set ${keyName} locally for this signing command`)
    try { account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`) }
    catch { throw new Error(`${keyName} is invalid`) }
    walletClient = createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0, timeout: 10000 }) })
  }
  return { publicClient, walletClient, account, chain, market, token, registry, artifacts }
}

export async function sendContract(ctx, call) {
  if (!ctx.account || !ctx.walletClient) throw new Error('Signing role is required')
  const actualId = await ctx.publicClient.getChainId()
  if (actualId !== 133) throw new Error('RPC chain ID changed; refusing transaction')
  const { request } = await ctx.publicClient.simulateContract({ ...call, account: ctx.account })
  const hash = await ctx.walletClient.writeContract(request)
  console.log(`Transaction submitted: ${hash}`)
  let receipt
  try { receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, timeout: 120000 }) }
  catch { throw new Error(`Receipt unknown for ${hash}; inspect it before retrying`) }
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`)
  return receipt
}
