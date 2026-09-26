import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RESUMABLE_PARENT_STATUSES, isRaiseResumable } from '@/lib/price-raise'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * The rule that decides whether `resumeOrphanedRaises` posts an escrowed job.
 *
 * An orphan row proves a replacement was WANTED. It does not prove the
 * original escrow ever came back. Two ways it doesn't: the cancel reverted
 * because a worker claimed the job a moment earlier, or two instances swept
 * the same raise and only one cancel could win. Either way the parent is
 * still live, and posting the replacement escrows the same task twice from
 * the same wallet.
 */
describe('isRaiseResumable', () => {
  it('resumes only when the parent escrow actually came back', () => {
    expect(isRaiseResumable('Cancelled')).toBe(true)
    expect(isRaiseResumable('Refunded')).toBe(true)
  })

  it('refuses while the parent is still live — that is the double escrow', () => {
    expect(isRaiseResumable('Open')).toBe(false)
    expect(isRaiseResumable('Accepted')).toBe(false)
    expect(isRaiseResumable('Submitted')).toBe(false)
  })

  it('refuses when the parent was already paid out', () => {
    expect(isRaiseResumable('Completed')).toBe(false)
  })

  it('refuses on no evidence — unknown is not permission', () => {
    expect(isRaiseResumable(undefined)).toBe(false)
    expect(isRaiseResumable(null)).toBe(false)
    expect(isRaiseResumable('')).toBe(false)
  })

  it('the resumable set stays deliberately small', () => {
    expect([...RESUMABLE_PARENT_STATUSES].sort()).toEqual(['Cancelled', 'Refunded'])
  })
})

/**
 * Every sweep here moves money and is reachable from the jobs page's after()
 * block, which runs on whichever warm lambda served the request. A
 * module-level `lastRunAt` is per-instance: on a warm fleet they all believe
 * they are due at the same moment. Two of them raising the same job is a
 * double escrow, so "each call is idempotent" does not save it — idempotence
 * per call doesn't compose into idempotence under concurrency.
 */
describe('money-moving sweeps throttle across instances', () => {
  const cases: { file: string; lease: string }[] = [
    { file: 'lib/price-raise.ts', lease: 'price-raise-sweep' },
    { file: 'lib/job-faucet.ts', lease: 'faucet-tick' },
    { file: 'lib/labor-settle.ts', lease: 'stuck-graded-sweep' },
    { file: 'lib/loan-sweep.ts', lease: 'loan-default-sweep' },
    { file: 'lib/loan-sweep.ts', lease: 'loan-reminder-sweep' },
  ]

  for (const { file, lease } of cases) {
    it(`${file} takes the '${lease}' lease`, () => {
      expect(read(file)).toContain(`acquireOpsLease('${lease}'`)
    })
  }

  it('none of them still gates on a module-level timestamp', () => {
    for (const file of new Set(cases.map((c) => c.file))) {
      expect(read(file)).not.toMatch(/^let last\w*At = 0$/m)
    }
  })
})

/**
 * Check-then-insert is two statements. At READ COMMITTED both callers can
 * find nothing and both insert, which inflates a worker's public earnings and
 * job count for work done once.
 */
describe('one completion event per job, decided by the database', () => {
  it('the insert defers to the unique index instead of trusting the SELECT', () => {
    const src = read('app/actions/labor.ts')
    expect(src).toContain('ensureCompletionUniqueIndex')
    expect(src).toContain('.onConflictDoNothing()')
    // Losing the race must stop the whole credit side-effect chain, not just
    // the row: score recalculation, feed entry and the payout email are the
    // winner's to do exactly once.
    const standDown = src.indexOf('this caller stands down')
    const recalc = src.indexOf('await recalculateCredit(workerAgent.id)')
    expect(standDown).toBeGreaterThan(-1)
    expect(standDown).toBeLessThan(recalc)
  })

  it('the index is partial, so only JOB_COMPLETED is constrained', () => {
    const src = read('lib/db/completion-index.ts')
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/)
    expect(src).toMatch(/WHERE event_type = 'JOB_COMPLETED'/)
    // A failure must not memoize as success — once the duplicates are cleaned
    // up, a later pass has to be able to create it.
    expect(src).toContain('indexReady = null')
  })
})

/**
 * The bounty-label webhook's check and its escrow are separated by a ~30s
 * ERC-4337 round trip. GitHub allows ten seconds and redelivers, so two
 * deliveries can both check ("nothing live"), both be right, and both post.
 * A fresher chain read cannot fix that — nothing is there to read yet. The
 * only thing that closes it is holding the issue across the whole post.
 */
describe('one bounty per issue, held across the escrow', () => {
  const src = read('app/api/github/webhook/route.ts')

  it('locks the issue before checking, not just before posting', () => {
    const lock = src.indexOf('bounty-issue:')
    const check = src.indexOf('specsForIssue(repoFullName, issueNumber)', src.indexOf("action === 'labeled'"))
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(check)
  })

  it('hands the lock back on every path that does not escrow', () => {
    // Otherwise "you are not linked yet" locks the issue for two minutes —
    // and linking then re-labelling takes about ten seconds.
    expect(src).toContain('const unlock =')
    const labeled = src.indexOf("action === 'labeled'")
    const posted = src.indexOf('BOUNTY_LABELED')
    const section = src.slice(labeled, posted)
    // one release per non-posting exit: unknown chain, already live, not
    // linked, no funded agent
    expect(section.match(/await unlock\(\)/g)?.length).toBe(4)
  })

  it('keeps the lock when the escrow is merely unconfirmed', () => {
    // Releasing on a pending post is how one label becomes two bounties.
    const pending = src.indexOf('isUserOpPending(error)')
    const holding = src.indexOf('holding the issue lock')
    expect(pending).toBeGreaterThan(-1)
    expect(holding).toBeGreaterThan(pending)
  })
})
