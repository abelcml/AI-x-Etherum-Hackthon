import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { contentHashOf, computeContentHash, signWorkProof, verifyWorkProof, WORK_PROOF_SCHEMA, type WorkProof } from '@/lib/attestation'

// A stand-in "oracle" (trusted scorer) and a malicious worker, so the test is
// self-contained and needs no configured platform key or chain.
const ORACLE = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const WORKER = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba')

function sampleProof(): WorkProof {
  return {
    schema: WORK_PROOF_SCHEMA,
    jobRef: '#142',
    kind: 'image',
    contentHash: contentHashOf({ text: 'a bamboo tumbler logo, flat vector' }),
    worker: 'agent_worker_1',
    requester: 'agent_requester_1',
    verdict: 'pass',
    grader: 'vision',
    gradedAt: 1_700_000_000,
  }
}

describe('work proof attestation', () => {
  it('fingerprints deliverable bytes deterministically', () => {
    const a = computeContentHash(Buffer.from('hello', 'utf8'))
    const b = contentHashOf({ text: 'hello' })
    expect(a).toBe(b)
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('base64 and dataUrl fingerprints agree', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const b64 = bytes.toString('base64')
    expect(contentHashOf({ base64: b64 })).toBe(contentHashOf({ dataUrl: `data:image/png;base64,${b64}` }))
  })

  it('round-trips: oracle signature verifies as trusted', async () => {
    const proof = sampleProof()
    const signed = await signWorkProof(proof, ORACLE)
    expect(signed).not.toBeNull()
    const res = await verifyWorkProof(proof, signed!.signature, ORACLE.address)
    expect(res.valid).toBe(true)
    expect(res.recovered.toLowerCase()).toBe(ORACLE.address.toLowerCase())
  })

  it('detects tampering: changing the deliverable invalidates the proof', async () => {
    const proof = sampleProof()
    const signed = await signWorkProof(proof, ORACLE)
    const tampered = { ...proof, contentHash: contentHashOf({ text: 'a DIFFERENT logo' }) }
    const res = await verifyWorkProof(tampered, signed!.signature, ORACLE.address)
    expect(res.valid).toBe(false)
  })

  it('detects verdict forgery: flipping fail→pass invalidates the proof', async () => {
    const failed = { ...sampleProof(), verdict: 'fail' }
    const signed = await signWorkProof(failed, ORACLE)
    const forged = { ...failed, verdict: 'pass' }
    const res = await verifyWorkProof(forged, signed!.signature, ORACLE.address)
    expect(res.valid).toBe(false)
  })

  it('self-attestation defense: a worker signing its own "pass" is rejected', async () => {
    const proof = sampleProof()
    // The worker forges a signature over the SAME proof...
    const selfSigned = await signWorkProof(proof, WORKER)
    // ...but a verifier who trusts the ORACLE recovers the worker address → not trusted.
    const res = await verifyWorkProof(proof, selfSigned!.signature, ORACLE.address)
    expect(res.valid).toBe(false)
    expect(res.recovered.toLowerCase()).toBe(WORKER.address.toLowerCase())
  })
})
