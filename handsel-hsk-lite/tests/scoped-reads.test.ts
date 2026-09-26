import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A shape test, not a behaviour test — the defect it guards was a missing
 * clause, not a broken function, so there is nothing to call.
 *
 * Three hot read paths each contained a query that LOOKED scoped and wasn't:
 *
 *   const taskIds = specs.map(...).filter(Boolean)
 *   const tasks = taskIds.length > 0 ? await db.select().from(agentTask) : []
 *
 * The guard reads like a lookup by id. The query has no WHERE clause at all,
 * so every agent_tasks row — including the full text of every deliverable
 * ever submitted — was fetched to render a handful of cards, on the busiest
 * public path on the site. It got slower every week and never got wrong, which
 * is exactly why nobody noticed.
 *
 * These assertions are deliberately literal: any `.from(agentTask)` in these
 * files must be followed by a WHERE. If a future edit reintroduces the
 * unscoped form, this fails before it ships.
 */
const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Statements are `await db\n.select(...)\n.from(x)\n.where(...)` across
 *  several lines, so slice from each `.from(<table>)` to the end of the
 *  statement and look for a where inside it. */
function statementsFrom(source: string, table: string): string[] {
  const out: string[] = []
  const needle = `.from(${table})`
  let at = source.indexOf(needle)
  while (at !== -1) {
    // Up to the next statement boundary: a blank line, or a line that starts
    // a new `const`/`return` at the same nesting depth. A generous window is
    // fine — a false PASS needs a real `.where(` in it.
    const rest = source.slice(at, at + 400)
    out.push(rest.split(/\n\s*\n/)[0]!)
    at = source.indexOf(needle, at + needle.length)
  }
  return out
}

describe('hot read paths stay scoped', () => {
  const cases: { file: string; table: string }[] = [
    { file: 'app/actions/guest.ts', table: 'agentTask' },
    { file: 'app/actions/guest.ts', table: 'jobSpec' },
    { file: 'app/actions/labor.ts', table: 'agentTask' },
    { file: 'app/api/github/webhook/route.ts', table: 'jobSpec' },
  ]

  for (const { file, table } of cases) {
    it(`${file}: every read of ${table} carries a WHERE`, () => {
      const statements = statementsFrom(read(file), table)
      expect(statements.length).toBeGreaterThan(0) // the read still exists
      for (const s of statements) expect(s).toMatch(/\.where\(/)
    })
  }

  it('guest.ts fetches specs for the visible slice, not the whole table', () => {
    const src = read('app/actions/guest.ts')
    // The slice must happen BEFORE the spec query, or scoping it is pointless.
    const slicedAt = src.indexOf('onchainJobs.slice(')
    const specQueryAt = src.indexOf('.from(jobSpec)')
    expect(slicedAt).toBeGreaterThan(-1)
    expect(slicedAt).toBeLessThan(specQueryAt)
  })

  it('the delegation tick keeps repost lineage in its scoped spec read', () => {
    // Scoping this read is only correct if it still reaches the SUCCESSOR of a
    // refunded subtask — the Refunded branch follows `parentSpecHash` to the
    // reposted job. A narrower query that fetched only the subtasks' own
    // hashes would silently dead-end every delegation whose worker failed a
    // grade, which is the common case, not an edge case.
    const src = read('lib/delegation.ts')
    const at = src.indexOf('.from(jobSpec)')
    const statement = src.slice(Math.max(0, at - 500), at + 300)
    expect(statement).toContain('parentSpecHash')
    expect(statement).toMatch(/\.where\(/)
  })

  it('/api/fleet does not read worker key ciphertext to compute a boolean', () => {
    const src = read('app/api/fleet/route.ts')
    // Public, unauthenticated route: name the columns, and let SQL answer the
    // one question asked about the encrypted key.
    expect(src).not.toMatch(/db\s*\.?\s*select\(\)\s*\.from\(agent\)/)
    expect(src).toContain('is not null')
  })

  it('the label-to-bounty webhook resolves an issue against chain state', () => {
    const src = read('app/api/github/webhook/route.ts')
    // Not `(await db.select().from(jobSpec)).find(...)` — that returned rows in
    // unspecified order and double-escrowed / stranded escrow on re-labels.
    expect(src).not.toMatch(/from\(jobSpec\)\)\.find\(/)
    expect(src).toContain('pickIssueJob')
  })
})
