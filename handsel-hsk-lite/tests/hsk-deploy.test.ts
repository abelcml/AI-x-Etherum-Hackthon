import { describe, expect, it } from 'vitest'
import { assertMockUsdcTarget, hskTestnet, selectDeploymentChain, verifyRpcChainId } from '../scripts/deploy-chain.mjs'

describe('deployment chain selection', () => {
  it('defines the HSK testnet endpoint and metadata', () => {
    const selected = selectDeploymentChain('hsk-testnet')
    expect(selected.chain.id).toBe(133)
    expect(selected.chain.rpcUrls.default.http).toContain('https://testnet.hsk.xyz')
    expect(selected.chain.blockExplorers.default.url).toBe('https://testnet-explorer.hsk.xyz')
    expect(selected.chain.nativeCurrency.symbol).toBe('HSK')
    expect(hskTestnet.id).toBe(133)
  })

  it('preserves Base and Base Sepolia and rejects unknown chain names', () => {
    expect(selectDeploymentChain('base').chain.id).toBe(8453)
    expect(selectDeploymentChain('base-sepolia').chain.id).toBe(84532)
    expect(() => selectDeploymentChain('hsk')).toThrow(/Unsupported ONCHAIN_CHAIN/)
  })
})

describe('MockUSDC deployment guard', () => {
  it('allows only HSK testnet', () => {
    expect(assertMockUsdcTarget('hsk-testnet').chain.id).toBe(133)
  })

  it('rejects another testnet before deployment', () => {
    expect(() => assertMockUsdcTarget('base-sepolia')).toThrow(/restricted to hsk-testnet/)
  })

  it('rejects mainnet before deployment', () => {
    expect(() => assertMockUsdcTarget('base')).toThrow(/restricted to hsk-testnet/)
  })

  it('rejects unknown network names before deployment', () => {
    expect(() => assertMockUsdcTarget('unknown')).toThrow(/Unsupported ONCHAIN_CHAIN/)
  })
})

describe('deployment RPC preflight', () => {
  it('rejects an endpoint reporting a chain ID other than the selected network', async () => {
    await expect(verifyRpcChainId({ getChainId: async () => 11155111 }, hskTestnet)).rejects.toThrow(
      /expects 133.*reports 11155111.*No transaction was sent/,
    )
  })

  it('accepts the expected chain ID', async () => {
    await expect(verifyRpcChainId({ getChainId: async () => 133 }, hskTestnet)).resolves.toBe(133)
  })
})
