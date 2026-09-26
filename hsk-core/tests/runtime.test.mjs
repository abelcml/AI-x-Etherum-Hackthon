import test from 'node:test'
import assert from 'node:assert/strict'
import { address, networkConfig, sendContract } from '../src/runtime.mjs'

test('only accepts HSK testnet and valid RPC protocol', () => {
  assert.equal(networkConfig({}).chain.id, 133)
  assert.throws(() => networkConfig({ ONCHAIN_CHAIN: 'base' }), /Only hsk/)
  assert.throws(() => networkConfig({ ONCHAIN_RPC_URL: 'file:///private' }), /HTTP/)
})
test('rejects invalid and zero contract addresses', () => {
  assert.throws(() => address('0x' + '0'.repeat(40), 'MARKET'), /nonzero/)
  assert.throws(() => address('secret', 'MARKET'), /nonzero/)
})
test('does not simulate or sign if RPC changed chain', async () => {
  await assert.rejects(sendContract({ account: {}, walletClient: {}, publicClient: { getChainId: async () => 1 } }, {}), /changed/)
})
test('unknown receipts return transaction identifier for manual recovery', async () => {
  await assert.rejects(sendContract({
    account: {}, walletClient: { writeContract: async () => '0xtest' },
    publicClient: { getChainId: async () => 133, simulateContract: async () => ({ request: {} }), waitForTransactionReceipt: async () => { throw new Error('timeout') } },
  }, {}), /Receipt unknown for 0xtest/)
})
