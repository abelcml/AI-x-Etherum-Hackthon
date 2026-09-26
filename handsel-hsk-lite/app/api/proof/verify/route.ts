import { verifyWorkProof, trustedAttester, type WorkProof } from '@/lib/attestation'

/**
 * Stateless verification: POST any {proof, signature} and get back who signed
 * it and whether that signer is the platform's trusted attester. This lets a
 * third party verify a proof they were handed (e.g. an off-chain certificate)
 * without our database — pure signature math.
 *
 *   POST /api/proof/verify  { "proof": {...}, "signature": "0x..." }
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  let proof: WorkProof
  let signature: `0x${string}`
  try {
    const body = await request.json()
    proof = body?.proof
    signature = body?.signature
    if (!proof || !signature) throw new Error('missing')
  } catch {
    return Response.json({ error: 'body must be JSON: { proof, signature }' }, { status: 400 })
  }
  try {
    const res = await verifyWorkProof(proof, signature)
    return Response.json({ valid: res.valid, recovered: res.recovered, trustedAttester: trustedAttester() })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'invalid signature' }, { status: 400 })
  }
}
