/**
 * The one rule that must never regress for GitHub repo jobs: CI green is a
 * grading signal, NEVER a release trigger. Only the requester's merge moves
 * money (docs/github-jobs.md) — a malicious-but-CI-passing diff must not be
 * able to pay itself out.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const readJobs = vi.fn()
const approveJob = vi.fn()

vi.mock('@/lib/onchain/labor', () => ({
  readJobs: (...a: unknown[]) => readJobs(...a),
  approveJob: (...a: unknown[]) => approveJob(...a),
  postJob: vi.fn(),
  raiseDispute: vi.fn(),
  resolveDispute: vi.fn(),
  submitWork: vi.fn(),
}))
vi.mock('@/lib/platform-feed', () => ({ logPlatformEvent: vi.fn(async () => {}) }))

import { autoApprovePassedJob } from '@/lib/labor-settle'

const spec = (over: Record<string, unknown> = {}) =>
  ({
    specHash: '0xabc',
    title: 'repo → acme/widgets: fix pagination',
    requesterAgentId: 'req-1',
    workerAgentId: 'wrk-1',
    onchainJobId: 42,
    autoApprove: true,
    repoFullName: 'acme/widgets',
    baseBranch: 'main',
    prNumber: 7,
    ciStatus: 'success',
    ...over,
  }) as never

beforeEach(() => {
  readJobs.mockReset()
  approveJob.mockReset()
  readJobs.mockResolvedValue([{ id: 42, status: 'Submitted', bounty: 25, worker: '0xw', minScore: 0, specHash: '0xabc' }])
})

describe('repo jobs never settle on a grader verdict', () => {
  it('refuses to release when CI passed but nobody merged', async () => {
    await autoApprovePassedJob(spec())
    expect(approveJob).not.toHaveBeenCalled()
    expect(readJobs).not.toHaveBeenCalled() // short-circuits before touching the chain
  })

  it('still refuses when the requester left autoApprove on', async () => {
    await autoApprovePassedJob(spec({ autoApprove: true, ciStatus: 'success' }), { authorization: 'grader' })
    expect(approveJob).not.toHaveBeenCalled()
  })

  it('does not affect non-repo jobs — those settle on the grader as before', async () => {
    // Reaches the chain read; whatever happens after is the pre-existing path.
    await autoApprovePassedJob(spec({ repoFullName: null, prNumber: null }))
    expect(readJobs).toHaveBeenCalled()
  })
})
