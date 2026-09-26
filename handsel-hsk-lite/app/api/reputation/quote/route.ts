import { evaluateReputation, trustedScorer, DEFAULT_TERMS, type CreditScoreProof } from '@/lib/reputation-lending'

/**
 * Reputation-gated limit quote — the read-only "LendingResolver" from the EAS
 * Reputation Lending lab, exposed as an endpoint. POST a credit-score proof
 * (EIP-712 signed by the platform oracle) and get back the four-gate decision
 * and the derived undercollateralized limit. No funds move — it only checks
 * conditions, including the self-attestation defense (attester == trusted
 * scorer), so a worker cannot quote itself a limit off a self-signed score.
 *
 *   POST /api/reputation/quote
 *   { "proof": { subject, score, issuedAt }, "signature": "0x…",
 *     "borrower": "<agentId|address>", "requestUsd"?: number }
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  let proof: CreditScoreProof
  let signature: `0x${string}`
  let borrower: string
  let requestUsd: number | undefined
  try {
    const b = await request.json()
    proof = b?.proof
    signature = b?.signature
    borrower = String(b?.borrower ?? '')
    requestUsd = b?.requestUsd != null ? Number(b.requestUsd) : undefined
    if (!proof || !signature || !borrower) throw new Error('missing')
  } catch {
    return Response.json({ error: 'body: { proof:{subject,score,issuedAt}, signature, borrower, requestUsd? }' }, { status: 400 })
  }
  try {
    const decision = await evaluateReputation({ proof, signature, borrower, requestUsd })
    return Response.json({ ...decision, trustedScorer: trustedScorer(), terms: DEFAULT_TERMS })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'invalid proof' }, { status: 400 })
  }
}
