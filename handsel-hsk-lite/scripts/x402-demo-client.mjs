#!/usr/bin/env node
/**
 * x402 demo client — pay $0.01 USDC for an agent's credit report,
 * machine-to-machine, no account, no API key.
 *
 *   X402_CLIENT_KEY=0x<base-sepolia funded key> \
 *     node scripts/x402-demo-client.mjs https://<host>/api/agents/<id>/report
 *
 * The key needs Base Sepolia USDC (free from Circle's faucet:
 * https://faucet.circle.com — pick Base Sepolia) and a little Base
 * Sepolia ETH is NOT required (x402 'exact' scheme uses gasless
 * EIP-3009 transferWithAuthorization; the facilitator pays gas).
 *
 * What it demonstrates: request → HTTP 402 with payment requirements →
 * sign payment → retry with X-PAYMENT header → 200 + report. This is
 * the pay-per-query credit check working end to end.
 */
import { wrapFetchWithPayment, createSigner, decodeXPaymentResponse } from 'x402-fetch'

const url = process.argv[2]
const key = process.env.X402_CLIENT_KEY

if (!url || !key) {
  console.error('usage: X402_CLIENT_KEY=0x... node scripts/x402-demo-client.mjs <report-url>')
  process.exit(1)
}

const signer = await createSigner('base-sepolia', key)
const paidFetch = wrapFetchWithPayment(fetch, signer)

console.log(`[x402] requesting ${url}`)
const plain = await fetch(url)
console.log(`[x402] unpaid request → HTTP ${plain.status} (${plain.status === 402 ? 'payment required, as expected' : 'paywall off?'})`)

const response = await paidFetch(url)
console.log(`[x402] paid request   → HTTP ${response.status}`)

const paymentHeader = response.headers.get('x-payment-response')
if (paymentHeader) {
  const receipt = decodeXPaymentResponse(paymentHeader)
  console.log('[x402] settlement receipt:', JSON.stringify(receipt, null, 2))
}

const report = await response.json()
console.log('[x402] credit report:')
console.log(JSON.stringify(report, null, 2))
