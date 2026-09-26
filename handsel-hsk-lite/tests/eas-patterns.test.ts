import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { signCreditScore, evaluateReputation, DEFAULT_TERMS, type CreditScoreProof } from '@/lib/reputation-lending'
import { cidV1Raw, cidOfJson, gatewayUrl } from '@/lib/ipfs'
import { UsedTickets } from '@/lib/claim-ticket'

const ORACLE = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const WORKER = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba')
const NOW = 1_800_000_000

// ─── Reputation Lending: the four gates ───────────────────────────────────
describe('reputation lending gates', () => {
  const proof: CreditScoreProof = { subject: 'agent_alice', score: 800, issuedAt: NOW - 1000 }

  it('approves a fresh, high, oracle-signed score for its own subject', async () => {
    const s = await signCreditScore(proof, ORACLE)
    const d = await evaluateReputation({ proof, signature: s!.signature, borrower: 'agent_alice', expectedScorer: ORACLE.address, now: NOW })
    expect(d.approved).toBe(true)
    // base 5 + (800-600)*0.2 = 45
    expect(d.limitUsd).toBe(45)
  })

  it('★ blocks self-attestation: worker signs its own score', async () => {
    const s = await signCreditScore(proof, WORKER) // not the oracle
    const d = await evaluateReputation({ proof, signature: s!.signature, borrower: 'agent_alice', expectedScorer: ORACLE.address, now: NOW })
    expect(d.approved).toBe(false)
    expect(d.checks.attesterTrusted).toBe(false)
    expect(d.limitUsd).toBe(0)
  })

  it('rejects a score about a different subject', async () => {
    const s = await signCreditScore(proof, ORACLE)
    const d = await evaluateReputation({ proof, signature: s!.signature, borrower: 'agent_bob', expectedScorer: ORACLE.address, now: NOW })
    expect(d.approved).toBe(false)
    expect(d.checks.subjectMatches).toBe(false)
  })

  it('rejects a stale score', async () => {
    const stale: CreditScoreProof = { subject: 'agent_alice', score: 800, issuedAt: NOW - DEFAULT_TERMS.maxAgeSec - 10 }
    const s = await signCreditScore(stale, ORACLE)
    const d = await evaluateReputation({ proof: stale, signature: s!.signature, borrower: 'agent_alice', expectedScorer: ORACLE.address, now: NOW })
    expect(d.checks.fresh).toBe(false)
    expect(d.approved).toBe(false)
  })

  it('rejects a below-minimum score and caps the request', async () => {
    const low: CreditScoreProof = { subject: 'agent_alice', score: 500, issuedAt: NOW }
    const s = await signCreditScore(low, ORACLE)
    const d = await evaluateReputation({ proof: low, signature: s!.signature, borrower: 'agent_alice', expectedScorer: ORACLE.address, now: NOW })
    expect(d.checks.scoreOk).toBe(false)
    expect(d.limitUsd).toBe(0)
  })

  it('denies a request that exceeds the derived limit', async () => {
    const s = await signCreditScore(proof, ORACLE)
    const d = await evaluateReputation({ proof, signature: s!.signature, borrower: 'agent_alice', requestUsd: 999, expectedScorer: ORACLE.address, now: NOW })
    expect(d.checks.withinLimit).toBe(false)
    expect(d.approved).toBe(false)
  })
})

// ─── IPFS content addressing ──────────────────────────────────────────────
describe('ipfs cid', () => {
  it('is deterministic and raw-sha256-CIDv1 (bafkrei…)', () => {
    const a = cidV1Raw(Buffer.from('hello world'))
    const b = cidV1Raw(Buffer.from('hello world'))
    expect(a).toBe(b)
    expect(a.startsWith('bafkrei')).toBe(true)
  })

  it('differs for different content and builds a gateway url', () => {
    expect(cidOfJson({ a: 1 })).not.toBe(cidOfJson({ a: 2 }))
    const cid = cidOfJson({ proof: 'x' })
    expect(gatewayUrl(cid)).toBe(`https://ipfs.io/ipfs/${cid}`)
  })
})

// ─── Ticketing: one-time claim (used mapping) ─────────────────────────────
describe('one-time claim tickets', () => {
  it('first claim wins; a second worker cannot steal it', () => {
    const t = new UsedTickets()
    expect(t.open('#142', 'alice')).toEqual({ won: true, holder: 'alice' })
    expect(t.open('#142', 'bob')).toEqual({ won: false, holder: 'alice' })
    // the holder re-opening is idempotent (still wins)
    expect(t.open('#142', 'alice').won).toBe(true)
  })

  it('redeem is single-use and holder-only', () => {
    const t = new UsedTickets()
    t.open('#142', 'alice')
    expect(t.redeem('#142', 'bob')).toBe(false) // not the holder
    expect(t.redeem('#142', 'alice')).toBe(true) // first redeem
    expect(t.redeem('#142', 'alice')).toBe(false) // replay blocked
    expect(t.isRedeemed('#142')).toBe(true)
  })

  it('release frees the slot for a reposted job', () => {
    const t = new UsedTickets()
    t.open('#142', 'alice')
    t.release('#142')
    expect(t.open('#142', 'bob')).toEqual({ won: true, holder: 'bob' })
  })
})
