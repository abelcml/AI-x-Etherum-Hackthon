/** Narrow settlement policy for the single-repository HSK hackathon demo. */

export type HskCiFact = { kind: 'ci'; headSha: string; passed: boolean }
export type HskMergeFact = { kind: 'merge'; headSha: string }
export type HskSettlementFact = HskCiFact | HskMergeFact

export type HskCheckGateConfig = { suiteAppId: number; requiredNames: string[] }
export type HskCheckRun = {
  name: string
  app?: { id?: number | null } | null
  head_sha: string
  status: string
  conclusion: string | null
}
export type HskChecksVerdict = { state: 'pending' | 'failure' | 'success'; reason: string }

export type HskSettlementFacts = {
  ci?: { headSha: string; passed: boolean }
  merge?: { headSha: string }
}

export type HskVerdictRecord = {
  passed: boolean | null
  output: string
  gradedAt: string
  hskSettlement?: HskSettlementFacts
  [key: string]: unknown
}

export function hskHackathonModeEnabled(value = process.env.HSK_HACKATHON_MODE): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isHskRepositoryConfigured(configured = process.env.HSK_GITHUB_REPOSITORY): boolean {
  if (typeof configured !== 'string') return false
  const allowed = configured.trim().toLowerCase()
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/.test(allowed)
}

/** Empty or malformed configuration never grants a repository webhook access. */
export function isHskRepositoryAllowed(
  repoFullName: unknown,
  configured = process.env.HSK_GITHUB_REPOSITORY,
): boolean {
  if (typeof repoFullName !== 'string' || typeof configured !== 'string') return false
  const repo = repoFullName.trim().toLowerCase()
  const allowed = configured.trim().toLowerCase()
  return isHskRepositoryConfigured(allowed) && repo === allowed
}

export function hskCheckGateConfig(
  appIdValue = process.env.HSK_REQUIRED_CHECK_SUITE_APP_ID,
  namesValue = process.env.HSK_REQUIRED_CHECK_NAMES,
): HskCheckGateConfig | null {
  if (typeof appIdValue !== 'string' || !/^[1-9]\d*$/.test(appIdValue.trim())) return null
  const suiteAppId = Number(appIdValue.trim())
  if (!Number.isSafeInteger(suiteAppId)) return null
  if (typeof namesValue !== 'string') return null
  const requiredNames = namesValue.split(',').map((name) => name.trim())
  if (
    requiredNames.length === 0 ||
    requiredNames.length > 20 ||
    requiredNames.some((name) => !name || name.length > 100) ||
    new Set(requiredNames).size !== requiredNames.length
  ) {
    return null
  }
  return { suiteAppId, requiredNames }
}

export function evaluateHskRequiredChecks(
  requiredNames: string[],
  suiteAppId: number,
  headSha: string,
  runs: HskCheckRun[],
  totalCount = runs.length,
): HskChecksVerdict {
  if (!requiredNames.length) return { state: 'pending', reason: 'required check list is empty' }
  if (!isValidGithubSha(headSha)) return { state: 'pending', reason: 'commit SHA is invalid' }
  if (totalCount > runs.length) return { state: 'pending', reason: 'check run list is incomplete' }

  const required = requiredNames.map((name) => {
    const matches = runs.filter((run) => run.name === name && run.app?.id === suiteAppId && run.head_sha.toLowerCase() === headSha.toLowerCase())
    return matches.length === 1 ? matches[0] : null
  })
  if (required.some((run) => run === null)) return { state: 'pending', reason: 'one or more required checks are missing or ambiguous' }
  if (required.some((run) => run!.status !== 'completed')) return { state: 'pending', reason: 'required checks are still running' }
  if (required.some((run) => run!.conclusion !== 'success')) return { state: 'failure', reason: 'a required check did not succeed' }
  return { state: 'success', reason: 'all configured checks passed on the commit' }
}

export function isValidGithubSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function hskSettlementFactsFrom(value: unknown): HskSettlementFacts {
  const record = asRecord(value)
  const stored = asRecord(record.hskSettlement)
  const ci = asRecord(stored.ci)
  const merge = asRecord(stored.merge)
  return {
    ...(isValidGithubSha(ci.headSha) && typeof ci.passed === 'boolean'
      ? { ci: { headSha: ci.headSha.toLowerCase(), passed: ci.passed } }
      : {}),
    ...(isValidGithubSha(merge.headSha) ? { merge: { headSha: merge.headSha.toLowerCase() } } : {}),
  }
}

/**
 * Fold one authenticated GitHub fact into the persisted verdict. Settlement
 * is ready only when the completed CI suite passed on the merged PR head.
 */
export function applyHskSettlementFact(
  previous: unknown,
  fact: HskSettlementFact,
): { accepted: boolean; verdict: HskVerdictRecord; settlementReady: boolean; ciPassed: boolean | null } {
  if (!isValidGithubSha(fact.headSha)) {
    const old = asRecord(previous) as HskVerdictRecord
    return { accepted: false, verdict: old, settlementReady: false, ciPassed: null }
  }

  const old = asRecord(previous)
  const facts = hskSettlementFactsFrom(old)
  const headSha = fact.headSha.toLowerCase()
  if (fact.kind === 'ci') {
    // Once a PR is merged, late suites from any other commit are stale and
    // must not replace the verdict associated with the merged content.
    if (facts.merge && facts.merge.headSha !== headSha) {
      return { accepted: false, verdict: old as HskVerdictRecord, settlementReady: false, ciPassed: facts.ci?.passed ?? null }
    }
    facts.ci = { headSha, passed: fact.passed }
  } else {
    facts.merge = { headSha }
  }

  const mergedAndPassed = Boolean(facts.merge && facts.ci && facts.ci.passed && facts.merge.headSha === facts.ci.headSha)
  const ciPassed = facts.ci && (!facts.merge || facts.ci.headSha === facts.merge.headSha) ? facts.ci.passed : null
  const verdict: HskVerdictRecord = {
    ...old,
    hskSettlement: facts,
    passed: mergedAndPassed ? true : ciPassed === false ? false : null,
  } as HskVerdictRecord
  return { accepted: true, verdict, settlementReady: mergedAndPassed, ciPassed }
}
