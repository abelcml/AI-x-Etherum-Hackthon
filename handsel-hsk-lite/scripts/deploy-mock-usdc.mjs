#!/usr/bin/env node
/** Deploy the freely-mintable demo token on HSK testnet only. */
import { readFileSync } from 'node:fs'
import { createWalletClient, createPublicClient, http, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertMockUsdcTarget, verifyRpcChainId } from './deploy-chain.mjs'

const die = (msg) => {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

const chainName = process.env.ONCHAIN_CHAIN || 'base-sepolia'
let deployment
try {
  deployment = assertMockUsdcTarget(chainName)
} catch (error) {
  die(error.message)
}

const { chain } = deployment
const rpcUrl = process.env.ONCHAIN_RPC_URL || chain.rpcUrls.default.http[0]
const pk = process.env.DEPLOYER_PRIVATE_KEY
if (!pk) die('Set DEPLOYER_PRIVATE_KEY.')

const SOURCE = 'contracts/src/MockUSDC.sol'
let solc
try {
  solc = (await import('solc')).default
} catch {
  die('Install project dependencies first; MockUSDC deployment uses the pinned solc dependency.')
}
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { [SOURCE]: { content: readFileSync(SOURCE, 'utf8') } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    }),
  ),
)
const errors = (out.errors || []).filter((e) => e.severity === 'error')
if (errors.length) die(errors.map((e) => e.formattedMessage).join('\n'))

const artifact = out.contracts[SOURCE].MockUSDC
const abi = artifact.abi
const bytecode = `0x${artifact.evm.bytecode.object}`
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) })
const pub = createPublicClient({ chain, transport: http(rpcUrl) })
try {
  await verifyRpcChainId(pub, chain)
} catch (error) {
  die(error.message)
}

console.log(`\nChain     ${chain.name} (${chain.id}) — testnet only`)
console.log(`Deployer  ${account.address}`)
console.log(`solc      ${solc.version()}`)
console.log(`Bytecode  ${keccak256(bytecode)}  (${bytecode.length / 2 - 1} bytes)`)

const balance = await pub.getBalance({ address: account.address })
if (balance === 0n) die(`Deployer has no ${chain.nativeCurrency.symbol} on this chain.`)

console.log('\nDeploying MockUSDC…')
const hash = await wallet.deployContract({ abi, bytecode })
console.log(`  tx: ${hash}`)
const receipt = await pub.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') die(`MockUSDC deployment reverted (tx ${hash}).`)
if (!receipt.contractAddress) die('No contract address in receipt — deploy failed.')

console.log(`\n✅ MockUSDC at ${receipt.contractAddress}`)
console.log(`\nSet in your platform env:`)
console.log(`  USDC_ADDRESS=${receipt.contractAddress}`)
