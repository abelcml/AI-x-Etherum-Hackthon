import { describe, expect, it } from 'vitest'
import { delegationCost } from '@/lib/delegation'

// Minimal row/jobs shapes — delegationCost only reads budgetUsd + subtasks
// and matches jobs by onchainJobId/status.
const row = (budget: string, subtasks: unknown[]) => ({ budgetUsd: budget, subtasks }) as never
const job = (id: number, status: string) => ({ id, status }) as never

describe('delegationCost', () => {
  it('splits escrow into paid / refunded / locked and pins gas+fee to zero', () => {
    const subtasks = [
      { title: 'a', bountyUsd: 4, onchainJobId: 1 },
      { title: 'b', bountyUsd: 3, onchainJobId: 2 },
      { title: 'c', bountyUsd: 3, onchainJobId: 3 },
    ]
    const jobs = [job(1, 'Completed'), job(2, 'Refunded'), job(3, 'Submitted')]
    const c = delegationCost(row('10.00', subtasks), jobs)
    expect(c.budgetUsd).toBe(10)
    expect(c.escrowedUsd).toBe(10)
    expect(c.releasedUsd).toBe(4)
    expect(c.refundedUsd).toBe(3)
    expect(c.lockedUsd).toBe(3)
    expect(c.gasUsd).toBe(0)
    expect(c.feeUsd).toBe(0)
    // reconciles exactly — released + refunded + locked == escrowed
    expect(c.releasedUsd + c.refundedUsd + c.lockedUsd).toBe(c.escrowedUsd)
  })

  it('ignores never-posted subtasks (nothing escrowed for them)', () => {
    const subtasks = [
      { title: 'a', bountyUsd: 5, onchainJobId: 1 },
      { title: 'b', bountyUsd: 5 }, // never posted
    ]
    const c = delegationCost(row('10.00', subtasks), [job(1, 'Completed')])
    expect(c.escrowedUsd).toBe(5)
    expect(c.releasedUsd).toBe(5)
  })

  it('counts a locally-failed subtask as refunded even without a Refunded job status', () => {
    const subtasks = [{ title: 'a', bountyUsd: 2, onchainJobId: 1, failed: true }]
    const c = delegationCost(row('2.00', subtasks), [job(1, 'Open')])
    expect(c.refundedUsd).toBe(2)
    expect(c.lockedUsd).toBe(0)
  })
})
