/**
 * A reverted UserOperation reaches the operator as ~2KB of calldata and gas
 * fields with the one useful sentence ABI-encoded inside it. This pins the
 * decoding of the exact live failure that sent an operator looking for a
 * billing page: an empty house wallet.
 */
import { describe, expect, it } from 'vitest'
import { decodeRevertReason, explainOnchainError } from '@/lib/onchain/errors'
import { topUpAmountUsd } from '@/lib/house-funding'

// The real error text from the live incident, trimmed to the parts that matter.
const LIVE_USDC_BALANCE_ERROR =
  'Execution reverted with reason: UserOperation reverted during simulation with reason: ' +
  '0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000' +
  '0000000000000000000000000000000000000d555344433a2062616c616e636500000000000000000000000000000000000000. ' +
  'Request Arguments: callData: 0xe9ae5c53010000 callGasLimit: 0 maxFeePerGas: 1.865969599 gwei'

describe('decodeRevertReason', () => {
  it('pulls the string out of an Error(string) payload', () => {
    expect(decodeRevertReason(LIVE_USDC_BALANCE_ERROR)).toBe('USDC: balance')
  })

  it('returns null when there is nothing to decode', () => {
    expect(decodeRevertReason('connect ETIMEDOUT')).toBeNull()
    expect(decodeRevertReason('0x08c379a0dead')).toBeNull() // too short to be a payload
  })
})

describe('explainOnchainError', () => {
  it('turns the empty-wallet revert into an actionable sentence, not a hex dump', () => {
    const out = explainOnchainError(new Error(LIVE_USDC_BALANCE_ERROR))
    expect(out).toContain('USDC: balance')
    expect(out).toContain('free to mint')
    expect(out).toContain('gas is already sponsored')
    expect(out).not.toContain('0x08c379a0')
    expect(out).not.toContain('callGasLimit')
  })

  it('explains the contract guards a user can actually hit', () => {
    expect(explainOnchainError(new Error('reverted with reason: SelfWork'))).toMatch(/own account posted/)
    expect(explainOnchainError(new Error('reverted with reason: NotRequester'))).toMatch(/posted the job/)
  })

  it('classifies rate limits and paymaster refusals', () => {
    expect(explainOnchainError(new Error('HTTP request failed. Status: 429'))).toMatch(/rate-limiting/)
    expect(explainOnchainError(new Error('paymaster rejected the request'))).toMatch(/gas sponsor/)
  })

  it('never returns a wall of text for an unknown error', () => {
    const out = explainOnchainError(new Error('x'.repeat(5000)))
    expect(out.length).toBeLessThanOrEqual(221)
  })
})

describe('topUpAmountUsd', () => {
  it('mints nothing when the wallet already covers the batch', () => {
    expect(topUpAmountUsd(120, 20)).toBe(0)
    expect(topUpAmountUsd(20, 20)).toBe(0)
  })

  it('mints in whole chunks that clear the shortfall', () => {
    expect(topUpAmountUsd(0, 20)).toBe(100)
    expect(topUpAmountUsd(5, 320, 100)).toBe(400)
    expect(topUpAmountUsd(0, 100, 100)).toBe(100)
  })
})
