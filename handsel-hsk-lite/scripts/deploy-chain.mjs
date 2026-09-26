#!/usr/bin/env node
/** Shared, strict chain selection for the deployment scripts. */
import { defineChain } from 'viem'
import { base, baseSepolia } from 'viem/chains'

export const hskTestnet = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.hsk.xyz'] },
    public: { http: ['https://testnet.hsk.xyz'] },
  },
  blockExplorers: {
    default: { name: 'HashKey Chain Testnet Explorer', url: 'https://testnet-explorer.hsk.xyz' },
  },
  testnet: true,
})

const deployments = {
  'base-sepolia': { chain: baseSepolia, isMainnet: false, isHsk: false },
  base: { chain: base, isMainnet: true, isHsk: false },
  'hsk-testnet': { chain: hskTestnet, isMainnet: false, isHsk: true },
}

export function selectDeploymentChain(name = 'base-sepolia') {
  const selected = deployments[name]
  if (!selected) {
    throw new Error(`Unsupported ONCHAIN_CHAIN "${name}". Choose base-sepolia, base, or hsk-testnet.`)
  }
  return { name, ...selected }
}

export function assertMockUsdcTarget(name) {
  const selected = selectDeploymentChain(name)
  if (!selected.isHsk) {
    throw new Error(`MockUSDC deployment is restricted to hsk-testnet (received ${name}).`)
  }
  return selected
}

/** Refuse to sign or broadcast if the configured endpoint points elsewhere. */
export async function verifyRpcChainId(publicClient, chain) {
  const actualChainId = await publicClient.getChainId()
  if (actualChainId !== chain.id) {
    throw new Error(`RPC chain ID mismatch: ONCHAIN_CHAIN expects ${chain.id} (${chain.name}), endpoint reports ${actualChainId}. No transaction was sent.`)
  }
  return actualChainId
}
