import { describe, it, expect } from 'vitest'
import { UserOpPendingError, isUserOpPending } from '@/lib/onchain/account'

// A receipt timeout is "not yet", not "no". Conflating the two is how a
// worker's finished job gets written down as failed while the chain says
// Submitted — two ledgers disagreeing, with a human needed to reconcile.

describe('UserOpPendingError', () => {
  const hash = '0x3c9aa7b0f7cdbc13f50b328d3b6e02953cae0f725a1196835093fd7c14deff01' as const

  it('carries the hash so the operation stays traceable', () => {
    expect(new UserOpPendingError(hash).userOpHash).toBe(hash)
  })

  it('says plainly that the operation may still land', () => {
    expect(new UserOpPendingError(hash).message).toMatch(/may still land/i)
  })

  it('is recognisable across a rethrow, unlike a message match', () => {
    const err: unknown = new UserOpPendingError(hash)
    expect(isUserOpPending(err)).toBe(true)
  })

  it('does not classify real failures as pending', () => {
    expect(isUserOpPending(new Error('execution reverted: USDC: balance'))).toBe(false)
    expect(isUserOpPending(null)).toBe(false)
    expect(isUserOpPending('timed out')).toBe(false)
  })
})

import { retry, retryRpc, isPendingUserOp } from '@/lib/labor-settle'

// retry() wraps postJob, which locks escrow. Retrying an operation that may
// already be on-chain is how a requester gets charged twice for one job.

describe('retry vs pending operations', () => {
  const pending = () => Object.assign(new Error('pending'), { name: 'UserOpPendingError' })

  it('recognises a pending error by name across module boundaries', () => {
    expect(isPendingUserOp(pending())).toBe(true)
    expect(isPendingUserOp(new Error('execution reverted'))).toBe(false)
  })

  it('never re-sends a pending money operation', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw pending()
    }
    await expect(retry(fn, 3, 1)).rejects.toThrow('pending')
    expect(calls).toBe(1) // not 3 — a second postJob would double-escrow
  })

  it('still retries ordinary failures', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      if (calls < 3) throw new Error('flaky')
      return 'ok'
    }
    await expect(retry(fn, 3, 1)).resolves.toBe('ok')
    expect(calls).toBe(3)
  })

  it('retryRpc leaves pending alone too (only 429s are transient)', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      throw pending()
    }
    await expect(retryRpc(fn, 3, 1)).rejects.toThrow('pending')
    expect(calls).toBe(1)
  })
})
