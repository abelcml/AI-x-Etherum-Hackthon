/**
 * x402 payment ledger — proof the machine-payment rail actually carries money.
 *
 * The paywall has been live for a while and left no trace anywhere: the
 * middleware verifies a payment, the handler runs, and nothing records that
 * a real settlement happened. So the only honest thing the UI could say
 * about x402 was a drawing of a handshake. You cannot verify a drawing.
 *
 * Every paid request now lands here — endpoint, payer, price, when — so the
 * public panel can show settlements as they occur instead of illustrating
 * them. Recording is best-effort and never blocks the response the caller
 * paid for: a ledger write must not be able to make a purchased request
 * fail. Self-migrating like platform_secrets, so no migration gates it.
 *
 * The payer address comes from the signed EIP-3009 authorization the client
 * presents; the middleware has already verified that signature by the time
 * a handler runs, so it is attribution we are entitled to trust — but it is
 * still truncated for display, never used as an identity.
 */
import { pool } from '@/lib/db'

let tableReady: Promise<void> | null = null

function ensureTable(): Promise<void> {
  tableReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS x402_payments (
         id bigserial PRIMARY KEY,
         endpoint text NOT NULL,
         payer text,
         amount_usd numeric(12, 4) NOT NULL,
         paid_at timestamptz NOT NULL DEFAULT now()
       )`,
    )
    .then(() => undefined)
  return tableReady
}

/** The payer of a verified x402 request, from the signed authorization. */
export function payerFromPaymentHeader(header: string | null): string | null {
  if (!header) return null
  try {
    const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    const from = payload?.payload?.authorization?.from
    return typeof from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(from) ? from : null
  } catch {
    return null
  }
}

/**
 * Record one settled payment. Call it from a handler that only runs behind
 * the paywall. No-ops silently when the paywall is off (nothing was paid)
 * and swallows every error (the caller already paid; they get their data).
 */
export async function recordX402Payment(input: { endpoint: string; request: Request; amountUsd: number }): Promise<void> {
  if (!process.env.X402_PAY_TO) return
  const header = input.request.headers.get('x-payment')
  if (!header) return // unpaid path (paywall disabled for this route)
  try {
    await ensureTable()
    await pool.query('INSERT INTO x402_payments (endpoint, payer, amount_usd) VALUES ($1, $2, $3)', [
      input.endpoint,
      payerFromPaymentHeader(header),
      input.amountUsd,
    ])
  } catch (error) {
    console.error('[x402-ledger] recording payment failed (non-fatal):', error)
  }
}

export type X402Payment = { endpoint: string; payer: string | null; amountUsd: number; paidAt: string }
export type X402Stats = {
  enabled: boolean
  payTo: string | null
  network: string
  totalPayments: number
  totalUsd: number
  recent: X402Payment[]
}

/** Live ledger read for the public panel. Cold start shows as cold start. */
export async function x402Stats(limit = 8): Promise<X402Stats> {
  const enabled = Boolean(process.env.X402_PAY_TO)
  const base: X402Stats = {
    enabled,
    payTo: process.env.X402_PAY_TO ?? null,
    network: 'base-sepolia',
    totalPayments: 0,
    totalUsd: 0,
    recent: [],
  }
  if (!enabled) return base
  try {
    await ensureTable()
    const [{ rows: totals }, { rows: recent }] = await Promise.all([
      pool.query<{ n: string; sum: string | null }>('SELECT count(*)::text AS n, sum(amount_usd)::text AS sum FROM x402_payments'),
      pool.query<{ endpoint: string; payer: string | null; amount_usd: string; paid_at: Date }>(
        'SELECT endpoint, payer, amount_usd, paid_at FROM x402_payments ORDER BY paid_at DESC LIMIT $1',
        [Math.max(1, Math.min(50, limit))],
      ),
    ])
    return {
      ...base,
      totalPayments: Number(totals[0]?.n ?? 0),
      totalUsd: Math.round(Number(totals[0]?.sum ?? 0) * 10000) / 10000,
      recent: recent.map((r) => ({
        endpoint: r.endpoint,
        payer: r.payer,
        amountUsd: Number(r.amount_usd),
        paidAt: new Date(r.paid_at).toISOString(),
      })),
    }
  } catch (error) {
    console.error('[x402-ledger] stats read failed:', error)
    return base
  }
}
