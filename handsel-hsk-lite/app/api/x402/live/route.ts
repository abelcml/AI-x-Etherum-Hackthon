import { x402Stats } from '@/lib/x402-ledger'

export const dynamic = 'force-dynamic'

/**
 * GET /api/x402/live — real settlements on the machine-payment rail.
 *
 * Deliberately NOT paywalled: this is the receipt for the paywall, and a
 * receipt you must pay to read proves nothing to a visitor. Payer addresses
 * are already public on Base Sepolia; nothing here is secret.
 */
export async function GET() {
  return Response.json(await x402Stats(8))
}
