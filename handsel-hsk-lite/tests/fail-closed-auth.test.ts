import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fail-closed guard for secret checks.
 *
 * `/api/runtime/wallet` — which sends an agent's USDC to any address the
 * caller names — gated on `if (expected && header !== expected)`. With the
 * env var unset or emptied, the condition short-circuits and the check
 * never runs: the endpoint is wide open, and the cost of being wrong is
 * the funds. Configuration is not authorization, and "no secret set" must
 * mean refuse, never allow.
 *
 * Like the throttle guard, this asserts a *shape* rather than a behaviour,
 * because the bug was a shape: a conditional whose false branch is silence.
 */

const API_ROOT = join(process.cwd(), 'app/api')

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...routeFiles(full))
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

/** `if (<name> && ...headers.get(...))` — a secret compared only when the
 *  secret happens to be configured. */
const FAIL_OPEN = /if\s*\(\s*\w+\s*&&\s*request\.headers\.get\(/

describe('secret checks fail closed', () => {
  it('no route compares a secret only when one is configured', () => {
    const offenders = routeFiles(API_ROOT).filter((f) => {
      const src = readFileSync(f, 'utf8')
      // Ignore the comment in the route that documents the old bug.
      const code = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n')
      return FAIL_OPEN.test(code)
    })
    expect(
      offenders,
      `these routes skip their secret check when the secret is unset:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
