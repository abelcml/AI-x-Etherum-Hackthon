/**
 * Resolve an agent from an on-chain address — case-insensitively, in one place.
 *
 * EVM addresses are the same address whether they arrive checksummed
 * (`0xAbC…`) or lowercased (`0xabc…`), and this codebase was comparing them
 * **both ways**:
 *
 *   lib/labor-dispatch.ts   lower(smart_account_address) = lower($1)   ← correct
 *   app/actions/labor.ts:38 lower(smart_account_address) = lower($1)   ← correct
 *   lib/stale-claim.ts      eq(smart_account_address, job.worker)      ← exact
 *   lib/exhausted-refund.ts eq(smart_account_address, job.requester)   ← exact
 *   app/actions/labor.ts:416 eq(smart_account_address, workerAddress)  ← exact
 *
 * Two call sites already lowercase, which is evidence the problem was hit
 * before and fixed locally rather than centrally. The exact-match half has
 * strictly worse failure modes, because each one is a *silent skip* on a money
 * path:
 *
 *  - `stale-claim` can't find the worker ⇒ the job is never walked out of
 *    `Accepted` ⇒ **escrow frozen forever**, which is the exact state that
 *    sweep exists to repair (docs/failure-modes.md §1).
 *  - `exhausted-refund` can't find the requester ⇒ no refund.
 *  - `creditWorkerForJob` can't find the worker ⇒ **paid on-chain with no
 *    credit event** — §8's leak, and its own error message
 *    ("no agent found for worker address") reads like a deleted agent when it
 *    may only ever have been a mismatched case.
 *
 * Whether case is actually the cause of any currently-stuck job is unproven —
 * an agent row really can be missing. That is why this returns a discriminated
 * result instead of `undefined`: the caller can say *which* reason it skipped,
 * so the next occurrence is answerable from a log line rather than by guessing.
 */
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

export type AgentRef = { id: string; name: string; userId: string; smartAccountAddress: string | null }

export type AgentLookup =
  | { found: true; agent: AgentRef }
  | { found: false; reason: 'zero-address' | 'no-agent-row' }

/** The all-zero address the contract uses for "unset" is never an agent. */
const ZERO = /^0x0+$/i

/**
 * Find the agent operating `address`. Compares lowercased on both sides, so a
 * checksummed on-chain address matches a lowercased stored one and vice versa.
 */
export async function agentByAddress(address: string | null | undefined): Promise<AgentLookup> {
  if (!address || ZERO.test(address)) return { found: false, reason: 'zero-address' }
  const [row] = await db
    .select({
      id: agent.id,
      name: agent.name,
      userId: agent.userId,
      smartAccountAddress: agent.smartAccountAddress,
    })
    .from(agent)
    .where(sql`lower(${agent.smartAccountAddress}) = ${address.toLowerCase()}`)
  return row ? { found: true, agent: row } : { found: false, reason: 'no-agent-row' }
}
