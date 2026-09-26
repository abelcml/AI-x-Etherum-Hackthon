import { describe, expect, it } from 'vitest'
import {
  applyHskSettlementFact,
  evaluateHskRequiredChecks,
  hskCheckGateConfig,
  hskHackathonModeEnabled,
  isHskRepositoryAllowed,
  isHskRepositoryConfigured,
} from '@/lib/github-settlement-policy'

const sha = (digit: string) => digit.repeat(40)
const baseVerdict = { passed: null, output: 'pending', gradedAt: '2026-09-26T00:00:00.000Z' }
const check = (over: Record<string, unknown> = {}) => ({
  name: 'unit',
  app: { id: 15368 },
  head_sha: sha('f'),
  status: 'completed',
  conclusion: 'success',
  ...over,
})

describe('HSK hackathon GitHub settlement gate', () => {
  it('requires the explicit mode flag and one valid exact repository allowlist', () => {
    expect(hskHackathonModeEnabled('true')).toBe(true)
    expect(hskHackathonModeEnabled('TRUE')).toBe(true)
    expect(hskHackathonModeEnabled('1')).toBe(false)
    expect(isHskRepositoryConfigured('ph1gros/handsel-hsk-lite')).toBe(true)
    expect(isHskRepositoryConfigured('')).toBe(false)
    expect(isHskRepositoryConfigured('ph1gros/*')).toBe(false)
    expect(isHskRepositoryAllowed('PH1GROS/Handsel-HSK-Lite', 'ph1gros/handsel-hsk-lite')).toBe(true)
    expect(isHskRepositoryAllowed('another/repo', 'ph1gros/handsel-hsk-lite')).toBe(false)
    expect(isHskRepositoryAllowed('ph1gros/handsel-hsk-lite', '')).toBe(false)
  })

  it('fails closed unless a positive suite app id and explicit check names are configured', () => {
    expect(hskCheckGateConfig('15368', 'unit, lint')).toEqual({ suiteAppId: 15368, requiredNames: ['unit', 'lint'] })
    expect(hskCheckGateConfig('', 'unit')).toBeNull()
    expect(hskCheckGateConfig('0', 'unit')).toBeNull()
    expect(hskCheckGateConfig('15368', '')).toBeNull()
    expect(hskCheckGateConfig('15368', 'unit,unit')).toBeNull()
  })

  it('requires every named check to be complete and successful on the exact commit from the selected app', () => {
    const names = ['unit', 'lint']
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check(), check({ name: 'lint' })]).state).toBe('success')
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check()]).state).toBe('pending')
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check(), check({ name: 'lint', status: 'in_progress', conclusion: null })]).state).toBe('pending')
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check(), check({ name: 'lint', conclusion: 'failure' })]).state).toBe('failure')
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check({ app: { id: 99 } }), check({ name: 'lint' })]).state).toBe('pending')
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check(), check({ name: 'lint', head_sha: sha('a') })]).state).toBe('pending')
    expect(evaluateHskRequiredChecks(names, 15368, sha('f'), [check(), check({ name: 'lint' })], 101).state).toBe('pending')
  })

  it('holds a merge until a passing completed suite for the same head arrives', () => {
    const mergedFirst = applyHskSettlementFact(baseVerdict, { kind: 'merge', headSha: sha('a') })
    expect(mergedFirst.settlementReady).toBe(false)
    expect(mergedFirst.verdict.passed).toBeNull()

    const ciLater = applyHskSettlementFact(mergedFirst.verdict, { kind: 'ci', headSha: sha('a'), passed: true })
    expect(ciLater.settlementReady).toBe(true)
    expect(ciLater.verdict.passed).toBe(true)
  })

  it('also settles when CI passes first and the human later merges that exact head', () => {
    const ciFirst = applyHskSettlementFact(baseVerdict, { kind: 'ci', headSha: sha('b'), passed: true })
    expect(ciFirst.settlementReady).toBe(false)
    expect(ciFirst.verdict.passed).toBeNull()

    const mergeLater = applyHskSettlementFact(ciFirst.verdict, { kind: 'merge', headSha: sha('b') })
    expect(mergeLater.settlementReady).toBe(true)
    expect(mergeLater.verdict.passed).toBe(true)
  })

  it('does not pay a failing suite or let a stale commit stand in for the merged head', () => {
    const failed = applyHskSettlementFact(baseVerdict, { kind: 'ci', headSha: sha('c'), passed: false })
    const mergedFailed = applyHskSettlementFact(failed.verdict, { kind: 'merge', headSha: sha('c') })
    expect(mergedFailed.settlementReady).toBe(false)
    expect(mergedFailed.verdict.passed).toBe(false)

    const merged = applyHskSettlementFact(baseVerdict, { kind: 'merge', headSha: sha('d') })
    const staleCi = applyHskSettlementFact(merged.verdict, { kind: 'ci', headSha: sha('e'), passed: true })
    expect(staleCi.accepted).toBe(false)
    expect(staleCi.settlementReady).toBe(false)
  })

  it('rejects absent or malformed Git commit SHAs', () => {
    const invalid = applyHskSettlementFact(baseVerdict, { kind: 'merge', headSha: 'not-a-sha' })
    expect(invalid.accepted).toBe(false)
    expect(invalid.settlementReady).toBe(false)
  })
})
