import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CLAIM_WARN_AT,
  CLAIM_WARN_GRACE,
  claimDeadlineMs,
  claimPhase,
  isClaimAbandoned,
  reclaimDecision,
} from '@/lib/stale-claim'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-07-26T12:00:00Z')
const ago = (h: number) => new Date(now.getTime() - h * HOUR)

// The contract has no exit from Accepted, so this predicate is the only
// thing standing between a vanished worker and permanently frozen escrow —
// and equally, the only thing that could steal a job from someone who is
// still working it.

describe('isClaimAbandoned', () => {
  const deadline = 6 * HOUR

  it('leaves a fresh claim alone', () => {
    expect(isClaimAbandoned(now, ago(1), null, deadline)).toBe(false)
  })

  it('reclaims a claim older than the deadline with no activity', () => {
    expect(isClaimAbandoned(now, ago(7), null, deadline)).toBe(true)
  })

  it('never reclaims a long-running job that is still reporting progress', () => {
    // Claimed two days ago, but the worker's task row was touched a minute
    // ago — reclaiming this would destroy work in flight.
    expect(isClaimAbandoned(now, ago(48), new Date(now.getTime() - 60_000), deadline)).toBe(false)
  })

  it('reclaims when the progress heartbeat itself went silent', () => {
    expect(isClaimAbandoned(now, ago(48), ago(9), deadline)).toBe(true)
  })

  it('treats unknown timing as NOT abandoned — never act on missing evidence', () => {
    expect(isClaimAbandoned(now, null, null, deadline)).toBe(false)
  })

  it('is exactly at the boundary, not before it', () => {
    expect(isClaimAbandoned(now, new Date(now.getTime() - deadline), null, deadline)).toBe(false)
    expect(isClaimAbandoned(now, new Date(now.getTime() - deadline - 1), null, deadline)).toBe(true)
  })
})

describe('claimDeadlineMs', () => {
  it('defaults to six hours and rejects nonsense overrides', () => {
    const original = process.env.CLAIM_DEADLINE_HOURS
    delete process.env.CLAIM_DEADLINE_HOURS
    expect(claimDeadlineMs()).toBe(6 * HOUR)
    process.env.CLAIM_DEADLINE_HOURS = 'soon'
    expect(claimDeadlineMs()).toBe(6 * HOUR)
    process.env.CLAIM_DEADLINE_HOURS = '-3'
    expect(claimDeadlineMs()).toBe(6 * HOUR)
    process.env.CLAIM_DEADLINE_HOURS = '2'
    expect(claimDeadlineMs()).toBe(2 * HOUR)
    if (original === undefined) delete process.env.CLAIM_DEADLINE_HOURS
    else process.env.CLAIM_DEADLINE_HOURS = original
  })
})

/**
 * Warn before taking the claim away.
 *
 * This sweep does two things: unfreeze the requester's escrow (urgent) and
 * write a permanent graded failure onto the worker (a punishment). The second
 * was landing with no notice — a desktop miner whose laptop slept came back to
 * a VERIFIED_TASK_FAILED it was never told was coming.
 */
describe('claimPhase', () => {
  const deadline = 6 * 60 * 60 * 1000
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000)

  it('a fresh claim is working', () => {
    expect(claimPhase(now, at(1), null, deadline)).toBe('working')
  })

  it('warns at 70% of the deadline, not before', () => {
    expect(claimPhase(now, at(4), null, deadline)).toBe('working') // 4/6 = 67%
    expect(claimPhase(now, at(4.5), null, deadline)).toBe('warn') // 4.5/6 = 75%
  })

  it('is expired past the deadline', () => {
    expect(claimPhase(now, at(7), null, deadline)).toBe('expired')
  })

  it('measures from the last sign of life, so a reporting job never escalates', () => {
    // Claimed two days ago but reported progress a minute ago.
    expect(claimPhase(now, at(48), new Date(now.getTime() - 60_000), deadline)).toBe('working')
  })

  it('no evidence at all is UNKNOWN, not working', () => {
    // Reporting it as `working` is what hid seven frozen jobs: for a job that
    // has been Accepted on-chain for days with no claim record, "still
    // working" is a false statement. It still must not be reclaimed.
    expect(claimPhase(now, null, null, deadline)).toBe('unknown')
  })
})

describe('reclaimDecision', () => {
  const deadline = 6 * 60 * 60 * 1000
  const grace = deadline * CLAIM_WARN_GRACE
  const ago = (ms: number) => new Date(now.getTime() - ms)

  it('does nothing while the claim is being worked', () => {
    expect(reclaimDecision(now, 'working', null, deadline)).toBe('wait')
  })

  it('never escalates an unknown claim, warned or not — invariant 5 holds', () => {
    expect(reclaimDecision(now, 'unknown', null, deadline)).toBe('wait')
    expect(reclaimDecision(now, 'unknown', ago(deadline), deadline)).toBe('wait')
  })

  it('warns once inside the warning window, then waits', () => {
    expect(reclaimDecision(now, 'warn', null, deadline)).toBe('warn')
    expect(reclaimDecision(now, 'warn', ago(60_000), deadline)).toBe('wait')
  })

  it('NEVER reclaims a claim that was never warned — it warns instead', () => {
    // The whole point. An expired-but-unwarned claim costs one more ops cycle.
    expect(reclaimDecision(now, 'expired', null, deadline)).toBe('warn')
  })

  it('waits out the grace window after warning, then reclaims', () => {
    expect(reclaimDecision(now, 'expired', ago(grace - 1000), deadline)).toBe('wait')
    expect(reclaimDecision(now, 'expired', ago(grace), deadline)).toBe('reclaim')
    expect(reclaimDecision(now, 'expired', ago(grace + 60_000), deadline)).toBe('reclaim')
  })

  it('a warned worker that comes back is never reclaimed', () => {
    // Activity moves the phase back to working; the stale warning is inert.
    expect(reclaimDecision(now, 'working', ago(grace * 10), deadline)).toBe('wait')
  })

  it('the warning fires with real time left to act on it', () => {
    // 30% of the deadline to notice, plus 15% of grace after it expires.
    expect(CLAIM_WARN_AT).toBeLessThan(1)
    expect(CLAIM_WARN_GRACE).toBeGreaterThan(0)
    expect((1 - CLAIM_WARN_AT) * deadline).toBeGreaterThan(30 * 60_000)
  })
})


/**
 * `unknown` must be visible, or the safety rule that produces it becomes a
 * silent escrow freeze — the third form of §5's limbo in one session, and this
 * one was created by my own guard.
 */
describe('unknown claims are counted, not reported as healthy', () => {
  const src = readFileSync(new URL('../lib/stale-claim.ts', import.meta.url), 'utf8')

  it('is blocked with its own reason', () => {
    expect(src).toContain("'no-claim-record'")
    expect(src).toContain("block(job.id, 'no-claim-record'")
  })

  it('is still never reclaimed', () => {
    // The fix is visibility. Acting on absent evidence would be the worse bug.
    expect(src).toMatch(/phase === 'working' \|\| phase === 'unknown'\) return 'wait'/)
  })

  it('isClaimAbandoned stays false for unknown', () => {
    expect(isClaimAbandoned(now, null, null, 6 * 3_600_000)).toBe(false)
  })
})
