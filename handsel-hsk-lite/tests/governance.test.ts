import { describe, expect, it } from 'vitest'
import {
  lockVotingPower,
  totalVotingPower,
  tallyVotes,
  isAutoVoteEligible,
  pickDelegateByUser,
  mustEscalate,
  CONFIDENCE_THRESHOLD,
  MAX_LOCK_WEEKS,
  WEEK_MS,
  QUORUM_POWER,
  type AutoVoteAgent,
  type DelegateDecision,
} from '@/lib/governance'

const mkDecision = (o: Partial<DelegateDecision> = {}): DelegateDecision => ({
  choice: 'for',
  confidence: 0.9,
  rationale: 'aligns with policy',
  escalate: false,
  minorityImpactHigh: false,
  ...o,
})

const mkAgent = (o: Partial<AutoVoteAgent> & { id: string; userId: string }): AutoVoteAgent => ({
  creditScore: 500,
  votePolicy: 'favor lower fees',
  autoVote: true,
  ...o,
})

const now = 1_000_000_000

describe('lockVotingPower (ve decay)', () => {
  it('a full-length lock starts near its amount and decays to zero', () => {
    const full = { amount: 100, unlockAt: now + MAX_LOCK_WEEKS * WEEK_MS }
    expect(lockVotingPower(full, now)).toBeCloseTo(100, 5) // ~amount at t=0
    // Halfway through a max lock → ~half power.
    const half = { amount: 100, unlockAt: now + (MAX_LOCK_WEEKS / 2) * WEEK_MS }
    expect(lockVotingPower(half, now)).toBeCloseTo(50, 5)
  })

  it('a shorter lock gives proportionally less power per token', () => {
    const oneYear = { amount: 100, unlockAt: now + 52 * WEEK_MS }
    const halfYear = { amount: 100, unlockAt: now + 26 * WEEK_MS }
    expect(lockVotingPower(halfYear, now)).toBeCloseTo(lockVotingPower(oneYear, now) / 2, 5)
  })

  it('is zero at/after unlock', () => {
    expect(lockVotingPower({ amount: 100, unlockAt: now }, now)).toBe(0)
    expect(lockVotingPower({ amount: 100, unlockAt: now - 1 }, now)).toBe(0)
  })

  it('never exceeds the locked amount', () => {
    const overlong = { amount: 100, unlockAt: now + 2 * MAX_LOCK_WEEKS * WEEK_MS }
    expect(lockVotingPower(overlong, now)).toBeLessThanOrEqual(100)
  })

  it('sums across locks', () => {
    const power = totalVotingPower(
      [
        { amount: 100, unlockAt: now + MAX_LOCK_WEEKS * WEEK_MS },
        { amount: 100, unlockAt: now + (MAX_LOCK_WEEKS / 2) * WEEK_MS },
      ],
      now,
    )
    expect(power).toBeCloseTo(150, 4)
  })
})

describe('tallyVotes', () => {
  it('passes only with quorum AND for > against', () => {
    const r = tallyVotes([
      { choice: 'for', power: 40 },
      { choice: 'against', power: 20 },
    ])
    expect(r.total).toBe(60)
    expect(r.quorumMet).toBe(true) // >= QUORUM_POWER (50)
    expect(r.passed).toBe(true)
  })

  it('fails below quorum even if unanimously for', () => {
    const r = tallyVotes([{ choice: 'for', power: QUORUM_POWER - 1 }])
    expect(r.quorumMet).toBe(false)
    expect(r.passed).toBe(false)
  })

  it('fails on a tie (for must strictly outweigh against)', () => {
    const r = tallyVotes([
      { choice: 'for', power: 30 },
      { choice: 'against', power: 30 },
    ])
    expect(r.quorumMet).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('abstain counts toward quorum but not the for/against decision', () => {
    const r = tallyVotes([
      { choice: 'for', power: 20 },
      { choice: 'against', power: 10 },
      { choice: 'abstain', power: 25 },
    ])
    expect(r.total).toBe(55)
    expect(r.quorumMet).toBe(true)
    expect(r.passed).toBe(true) // 20 > 10
  })
})

describe('isAutoVoteEligible (owner opt-in only — NOT a credit gate)', () => {
  it('requires opt-in and a non-empty policy; credit score is irrelevant', () => {
    expect(isAutoVoteEligible(mkAgent({ id: 'a', userId: 'u' }))).toBe(true)
    // A low credit score does NOT disqualify — trusting the delegate is the owner's call.
    expect(isAutoVoteEligible(mkAgent({ id: 'a', userId: 'u', creditScore: 300 }))).toBe(true)
    expect(isAutoVoteEligible(mkAgent({ id: 'a', userId: 'u', autoVote: false }))).toBe(false)
    expect(isAutoVoteEligible(mkAgent({ id: 'a', userId: 'u', votePolicy: '   ' }))).toBe(false)
    expect(isAutoVoteEligible(mkAgent({ id: 'a', userId: 'u', votePolicy: null }))).toBe(false)
  })
})

describe('pickDelegateByUser (one delegate per owner)', () => {
  it('picks one delegate per owner; credit score is only a deterministic tie-break', () => {
    const agents = [
      mkAgent({ id: 'a1', userId: 'alice', creditScore: 800 }),
      mkAgent({ id: 'a2', userId: 'alice', creditScore: 950 }), // higher → tie-break wins for alice
      mkAgent({ id: 'a3', userId: 'alice', creditScore: 999, autoVote: false }), // opted out → ignored
      mkAgent({ id: 'b1', userId: 'bob', creditScore: 320 }), // low score still eligible → bob has a delegate
    ]
    const picked = pickDelegateByUser(agents)
    expect(picked.get('alice')?.id).toBe('a2')
    expect(picked.get('bob')?.id).toBe('b1')
    expect(picked.size).toBe(2)
  })

  it('returns an empty map when nobody opted in', () => {
    expect(pickDelegateByUser([mkAgent({ id: 'a', userId: 'u', autoVote: false })]).size).toBe(0)
  })
})

describe('mustEscalate (human-in-the-loop guardrail)', () => {
  it('auto-casts a confident, low-impact recommendation', () => {
    expect(mustEscalate(mkDecision({ confidence: 0.9 }))).toBe(false)
  })

  it('escalates below the confidence floor', () => {
    expect(mustEscalate(mkDecision({ confidence: CONFIDENCE_THRESHOLD - 0.01 }))).toBe(true)
  })

  it('always escalates high minority-impact, even at full confidence', () => {
    expect(mustEscalate(mkDecision({ confidence: 1, minorityImpactHigh: true }))).toBe(true)
  })

  it('honors the delegate\'s own escalate flag', () => {
    expect(mustEscalate(mkDecision({ confidence: 1, escalate: true }))).toBe(true)
  })
})
