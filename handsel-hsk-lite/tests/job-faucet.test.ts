import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { FAUCET_TEMPLATES, computeRefill } from '@/lib/job-faucet'

describe('computeRefill', () => {
  it('fills up to the target', () => {
    expect(computeRefill({ openCount: 0, target: 3, postedToday: 0, dailyMax: 15 })).toBe(2) // perTick cap
    expect(computeRefill({ openCount: 2, target: 3, postedToday: 0, dailyMax: 15 })).toBe(1)
    expect(computeRefill({ openCount: 3, target: 3, postedToday: 0, dailyMax: 15 })).toBe(0)
    expect(computeRefill({ openCount: 5, target: 3, postedToday: 0, dailyMax: 15 })).toBe(0)
  })

  it('respects the daily budget', () => {
    expect(computeRefill({ openCount: 0, target: 3, postedToday: 15, dailyMax: 15 })).toBe(0)
    expect(computeRefill({ openCount: 0, target: 3, postedToday: 14, dailyMax: 15 })).toBe(1)
    expect(computeRefill({ openCount: 0, target: 3, postedToday: 99, dailyMax: 15 })).toBe(0) // never negative
  })
})

describe('faucet catalog', () => {
  it('has a healthy, bounded catalog', () => {
    expect(FAUCET_TEMPLATES.length).toBeGreaterThanOrEqual(8)
    const titles = new Set(FAUCET_TEMPLATES.map((t) => t.title))
    expect(titles.size).toBe(FAUCET_TEMPLATES.length) // unique titles
    for (const t of FAUCET_TEMPLATES) {
      expect(t.testCode).toMatch(/assert /)
      expect(t.bountyUsd).toBeGreaterThanOrEqual(1)
      expect(t.bountyUsd).toBeLessThanOrEqual(3)
      expect(t.acceptanceCriteria.length).toBeGreaterThanOrEqual(10) // postJobAction's own floor
      expect(t.description.length).toBeGreaterThan(40) // self-contained spec
    }
  })

  // The load-bearing check: every template must be SOLVABLE and its
  // asserts CORRECT — a faucet job with broken tests would fail every
  // worker and poison their credit scores. Runs each reference solution
  // + its acceptance tests through real Python, exactly like the grader.
  it('every template passes its own acceptance tests (real python3)', () => {
    for (const t of FAUCET_TEMPLATES) {
      const program = `${t.referenceSolution}\n\n${t.testCode}\nprint("OK")`
      let out = ''
      try {
        out = execFileSync('python3', ['-c', program], { encoding: 'utf8', timeout: 10_000 })
      } catch (e: any) {
        throw new Error(`template "${t.title}" failed its own tests:\n${e.stderr ?? e.message}`)
      }
      expect(out.trim()).toBe('OK')
    }
  })
})
