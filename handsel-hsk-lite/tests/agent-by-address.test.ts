import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * An EVM address is the same address checksummed or lowercased, and this
 * codebase compared them BOTH ways. Two call sites already lowercased — which
 * is evidence the problem was hit before and fixed locally instead of
 * centrally — while three compared exactly, and each of those is a silent skip
 * on a money path:
 *
 *   stale-claim      can't find the worker    ⇒ escrow frozen forever (§1)
 *   exhausted-refund can't find the requester ⇒ no refund
 *   creditWorkerForJob can't find the worker  ⇒ PAID with no credit event (§8)
 *
 * Whether case was the cause of any currently-stuck job is unproven; an agent
 * row really can be missing. That is why the helper returns a reason instead of
 * undefined — so the next occurrence is answerable from a log line.
 */
describe('address comparisons on money paths', () => {
  const files = ['lib/stale-claim.ts', 'lib/exhausted-refund.ts', 'app/actions/labor.ts']

  for (const f of files) {
    it(`${f} no longer compares smartAccountAddress exactly`, () => {
      // `eq(agent.smartAccountAddress, <onchain address>)` is the bug shape.
      expect(read(f)).not.toMatch(/eq\((?:agent|agentTable)\.smartAccountAddress,\s*(?:job|worker|requester)/)
    })

    it(`${f} routes the lookup through agentByAddress`, () => {
      expect(read(f)).toContain('agentByAddress')
    })
  }

  it('the helper lowercases both sides in SQL', () => {
    const src = read('lib/agent-by-address.ts')
    expect(src).toMatch(/lower\(\$\{agent\.smartAccountAddress\}\)/)
    expect(src).toContain('.toLowerCase()')
  })

  it('the all-zero address is never an agent', () => {
    // job.worker is 0x000… on an unclaimed job; that is not a missing row.
    const src = read('lib/agent-by-address.ts')
    expect(src).toContain("'zero-address'")
    expect(src).toMatch(/\^0x0\+\$/)
  })

  it('a failed lookup carries a reason, so the skip is not silent', () => {
    const src = read('lib/agent-by-address.ts')
    expect(src).toContain("reason: 'zero-address' | 'no-agent-row'")
  })
})

/**
 * The sweep used to `continue` past an unresolvable job with no trace, which
 * is the same invisible limbo as §5: escrow frozen and nothing saying why.
 */
describe('blocked jobs are surfaced by reason, not skipped', () => {
  const src = read('lib/stale-claim.ts')

  it('EVERY declared reason has exactly one block() call site', () => {
    // The first version of this instrumentation covered the address lookups
    // and left `!spec?.requesterAgentId` silent — the same defect one line
    // earlier, which is why the counter read 0 while seven jobs were skipped.
    //
    // So the expected count is DERIVED from the BlockedReason union rather
    // than hardcoded: adding a reason without a call site fails, and adding a
    // call site without a reason fails to typecheck. A hardcoded number just
    // made this test the thing you edit to make the build green.
    const union = src.slice(src.indexOf('export type BlockedReason'), src.indexOf('export type ReclaimReport'))
    const reasons = [...union.matchAll(/\| '([a-z-]+)'/g)].map((m) => m[1])
    expect(reasons.length).toBeGreaterThanOrEqual(5)
    for (const reason of reasons) expect(src, reason).toContain(`block(job.id, '${reason}'`)
    expect(src.match(/block\(job\.id, '/g)?.length).toBe(reasons.length)
  })

  it('a bare continue no longer precedes the first block()', () => {
    const loop = src.indexOf('for (const job of accepted)')
    const firstBlock = src.indexOf('block(job.id,', loop)
    const between = src.slice(loop, firstBlock)
    // `examined++` and the try{ are fine; a naked `continue` is not.
    expect(between).not.toMatch(/^\s*continue$/m)
  })

  it('the ops-cycle line names the reasons, not just a total', () => {
    // A count with no name tells you a wall was hit, not which wall.
    expect(read('lib/ops-cycle.ts')).toContain('formatBlocked')
  })
})

describe('formatBlocked', () => {
  it('is empty when nothing is blocked, so a healthy line stays quiet', async () => {
    const { formatBlocked } = await import('@/lib/stale-claim')
    expect(formatBlocked({})).toBe('')
    expect(formatBlocked({ 'no-spec': 0 })).toBe('')
  })

  it('names each reason with its count', async () => {
    const { formatBlocked } = await import('@/lib/stale-claim')
    expect(formatBlocked({ 'no-spec': 7 })).toBe(', BLOCKED no-spec=7')
    expect(formatBlocked({ 'no-spec': 7, 'unresolvable-worker': 2 })).toBe(
      ', BLOCKED no-spec=7 unresolvable-worker=2',
    )
  })
})
