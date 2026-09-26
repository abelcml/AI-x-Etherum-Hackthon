import { computeMarketHealth } from '@/lib/market-health'

/** GET /api/market-health — see lib/market-health.ts for why this is public. */
export async function GET() {
  return Response.json(await computeMarketHealth())
}
