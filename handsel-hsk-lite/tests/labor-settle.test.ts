/**
 * Settlement retry tests. Pins the live incident where Alchemy free-tier
 * 429s killed the one-shot approve/refund step: transient RPC errors must
 * be retried, everything else must fail fast (an on-chain revert is a
 * fact, not a flake).
 */
import { describe, it, expect } from 'vitest'
import { isTransientRpcError, retryRpc, retry } from '@/lib/labor-settle'

describe('isTransientRpcError', () => {
  it('classifies rate-limit shapes as transient', () => {
    expect(isTransientRpcError(new Error('HTTP request failed. Status: 429'))).toBe(true)
    expect(isTransientRpcError(new Error('You have exceeded the rate limit for this endpoint.'))).toBe(true)
    expect(isTransientRpcError(new Error('Too Many Requests'))).toBe(true)
    expect(isTransientRpcError(new Error('exceeded its compute units per second capacity'))).toBe(true)
  })

  it('does not classify real failures as transient', () => {
    expect(isTransientRpcError(new Error('Execution reverted: USDC: balance'))).toBe(false)
    expect(isTransientRpcError(new Error('nonce too low'))).toBe(false)
  })
})

describe('retryRpc', () => {
  it('retries transient errors and succeeds', async () => {
    let calls = 0
    const result = await retryRpc(
      async () => {
        calls++
        if (calls < 3) throw new Error('429 Too Many Requests')
        return 'ok'
      },
      3,
      1, // 1ms backoff — no real waiting in tests
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('fails fast on non-transient errors — a revert must never be re-fired', async () => {
    let calls = 0
    await expect(
      retryRpc(
        async () => {
          calls++
          throw new Error('Execution reverted: USDC: balance')
        },
        3,
        1,
      ),
    ).rejects.toThrow(/reverted/)
    expect(calls).toBe(1)
  })

  it('gives up after the attempt budget', async () => {
    let calls = 0
    await expect(
      retryRpc(
        async () => {
          calls++
          throw new Error('429')
        },
        3,
        1,
      ),
    ).rejects.toThrow(/429/)
    expect(calls).toBe(3)
  })
})

describe('retry (post-irreversible bookkeeping)', () => {
  it('retries any error — this path runs after money already moved', async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error('db timeout')
        return 'recorded'
      },
      3,
      1,
    )
    expect(result).toBe('recorded')
    expect(calls).toBe(2)
  })
})
