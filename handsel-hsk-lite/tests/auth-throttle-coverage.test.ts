import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Coverage guard, not a unit test.
 *
 * `/api/wallet/withdraw` takes an email + password and pays out on success,
 * and it shipped without the throttle every other credential-taking route
 * had — an unthrottled password oracle whose reward is the funds. The bug
 * was not in any function; it was a route that never got wired up. So the
 * test asserts the wiring, which is the thing that was actually missing.
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

describe('credential-taking routes are throttled', () => {
  const files = routeFiles(API_ROOT)

  it('finds the API surface at all (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('every route that compares a password is behind authThrottled', () => {
    const unguarded = files.filter((f) => {
      const src = readFileSync(f, 'utf8')
      const comparesPassword = /bcrypt\.compare|verifyPassword/.test(src)
      if (!comparesPassword) return false
      return !/authThrottled/.test(src)
    })
    expect(unguarded, `these routes accept a password with no durable throttle:\n${unguarded.join('\n')}`).toEqual([])
  })
})
