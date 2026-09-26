import { describe, expect, it } from 'vitest'
import { LIVE_JOB_STATUSES, pickIssueJob } from '@/lib/bounty-label'

/**
 * The label-to-bounty bot's two chain-state decisions. Both used to be
 * answered by a JavaScript `.find` over the whole job_specs table, which
 * picked whatever row Postgres returned first — and an issue can own several
 * spec rows (label → cancel → re-label, or a failed grade that reposted).
 *
 * Each test below is one of the two money bugs that produced.
 */
describe('pickIssueJob', () => {
  const spec = (id: number | null) => ({ onchainJobId: id, specHash: `0xspec${id}` })
  const statuses = (m: Record<number, string>) => (id: number) => m[id]

  it('finds a live job behind a stale one — a second label must not escrow twice', () => {
    // Newest-first, but the FIRST row is a finished job. The old `.find`
    // returned it, read "not live", and posted a duplicate bounty.
    const candidates = [spec(41), spec(42)]
    const found = pickIssueJob(candidates, statuses({ 41: 'Completed', 42: 'Accepted' }))
    expect(found?.jobId).toBe(42)
  })

  it('returns null only when no candidate is live', () => {
    const candidates = [spec(41), spec(42)]
    expect(pickIssueJob(candidates, statuses({ 41: 'Completed', 42: 'Refunded' }))).toBeNull()
  })

  it('prefers the newest live job when several are live', () => {
    const candidates = [spec(50), spec(49)] // caller orders newest-first
    expect(pickIssueJob(candidates, statuses({ 49: 'Open', 50: 'Open' }))?.jobId).toBe(50)
  })

  it('an unlabel refunds the Open job, not the first row', () => {
    // The bug that stranded escrow: `.find` matched the dead job, "cancelled"
    // it, and left the real Open escrow locked with the label gone.
    const candidates = [spec(41), spec(42)]
    const found = pickIssueJob(candidates, statuses({ 41: 'Completed', 42: 'Open' }), ['Open'])
    expect(found?.jobId).toBe(42)
  })

  it('an unlabel never touches a claimed job — a worker outlives the label', () => {
    const candidates = [spec(42)]
    expect(pickIssueJob(candidates, statuses({ 42: 'Accepted' }), ['Open'])).toBeNull()
    expect(pickIssueJob(candidates, statuses({ 42: 'Submitted' }), ['Open'])).toBeNull()
  })

  it('skips rows never posted on-chain and jobs the chain does not know', () => {
    expect(pickIssueJob([spec(null)], statuses({}))).toBeNull()
    expect(pickIssueJob([spec(99)], statuses({}))).toBeNull()
  })

  it('an empty candidate list is not an error', () => {
    expect(pickIssueJob([], statuses({ 1: 'Open' }))).toBeNull()
  })

  it('Accepted and Submitted both count as live — they hold real escrow', () => {
    expect(LIVE_JOB_STATUSES).toContain('Accepted')
    expect(LIVE_JOB_STATUSES).toContain('Submitted')
    expect(LIVE_JOB_STATUSES).not.toContain('Completed')
    expect(LIVE_JOB_STATUSES).not.toContain('Refunded')
  })
})
