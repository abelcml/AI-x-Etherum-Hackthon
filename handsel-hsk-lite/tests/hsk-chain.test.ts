import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('HSKChain testnet configuration', () => {
  it('selects chain 133 with the documented RPC, HSK gas, and explorer', async () => {
    vi.stubEnv('ONCHAIN_CHAIN', 'hsk-testnet')
    vi.resetModules()

    const { CHAIN, EXPLORER_URL } = await import('@/lib/onchain/config')

    expect(CHAIN.id).toBe(133)
    expect(CHAIN.name).toBe('HSKChain Testnet')
    expect(CHAIN.testnet).toBe(true)
    expect(CHAIN.nativeCurrency.symbol).toBe('HSK')
    expect(CHAIN.rpcUrls.default.http).toContain('https://testnet.hsk.xyz')
    expect(EXPLORER_URL).toBe('https://testnet-explorer.hsk.xyz')
  })

  it('classifies HSK testnet as safe test money and labels its token accurately', async () => {
    vi.stubEnv('ONCHAIN_CHAIN', 'hsk-testnet')
    vi.stubEnv('SOLANA_CLUSTER', '')
    vi.stubEnv('SOLANA_PROGRAM_ID', '')
    vi.stubEnv('SOLANA_RPC_URL', '')
    vi.stubEnv('USDC_ADDRESS', '')
    vi.stubEnv('MOCK_USDC_ADDRESS', '')
    vi.stubEnv('LABOR_MARKET_ADDRESS', '0x0000000000000000000000000000000000001337')
    vi.resetModules()

    const [{ isRealMoney }, { feedMeta }] = await Promise.all([
      import('@/lib/onchain/real-money'),
      import('@/lib/feed-meta'),
    ])
    const meta = feedMeta()

    expect(isRealMoney()).toBe(false)
    expect(meta.environment).toBe('testnet')
    expect(meta.realMoney).toBe(false)
    expect(meta.currency).toBe('test token')
    expect(meta.currencyLabel).toMatch(/HSK testnet token/i)
    expect(meta.currencyLabel).toMatch(/no monetary value/i)
    expect(meta.currencyLabel).not.toMatch(/Circle USDC/i)
    expect(meta.explorerUrl).toBe('https://testnet-explorer.hsk.xyz/address/0x0000000000000000000000000000000000001337')
  })

  it('uses the documented public HSK RPC as a fallback', async () => {
    const { PUBLIC_RPC_URLS, withPublicFallbacks } = await import('@/lib/onchain/transport')

    expect(PUBLIC_RPC_URLS[133]).toEqual(['https://testnet.hsk.xyz'])
    expect(withPublicFallbacks(['https://operator.example'], 133)).toEqual([
      'https://operator.example',
      'https://testnet.hsk.xyz',
    ])
  })
})
