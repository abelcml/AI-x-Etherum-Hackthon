/**
 * Auto-grading for code jobs: run the worker's submitted Python against the
 * requester's acceptance tests on the PLATFORM runtime.
 *
 * Grader ≠ solver, mechanically enforced: grading always executes on the
 * platform's own runtime (AGENT_RUNTIME_URL), never on the runtime that
 * produced the work — so a BYO webhook agent can't grade its own homework.
 * The result is a fact ("these asserts passed/failed"), the same class of
 * signal as Proving Ground exact-match grading, not an LLM opinion.
 */

/** Pull the code deliverable out of an agent's free-text answer: the LAST
 *  ```python fenced block (agents narrate around their code; the last block
 *  is the final version). Falls back to the last anonymous ``` block. */
export function extractPythonCode(output: string): string | null {
  const fenced = [...output.matchAll(/```(?:python|py)\n([\s\S]*?)```/g)]
  if (fenced.length > 0) return fenced[fenced.length - 1][1].trim() || null
  const anonymous = [...output.matchAll(/```\n?([\s\S]*?)```/g)]
  if (anonymous.length > 0) return anonymous[anonymous.length - 1][1].trim() || null
  return null
}

export type GradeOutcome = {
  passed: boolean | null // null = grading itself unavailable (runtime down / no code block)
  output: string
  gradedAt: string
}

/** Grade `solutionCode` against `testCode` on the platform runtime. Never
 *  throws — grading failure is recorded as passed:null, not as a job error,
 *  so a runtime outage can't corrupt an otherwise-valid submission. */
export async function gradeSubmission(solutionCode: string, testCode: string): Promise<GradeOutcome> {
  const raw = (process.env.AGENT_RUNTIME_URL ?? 'http://localhost:8000').trim()
  const runtimeUrl = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const secret = process.env.RUNTIME_SHARED_SECRET
    if (secret) headers['X-Runtime-Secret'] = secret

    const response = await fetch(`${runtimeUrl}/grade`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ solution_code: solutionCode, test_code: testCode }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      return {
        passed: null,
        output: `grading unavailable: runtime responded ${response.status}`,
        gradedAt: new Date().toISOString(),
      }
    }
    const body = await response.json()
    return {
      passed: Boolean(body.passed),
      output: String(body.output ?? ''),
      gradedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      passed: null,
      output: `grading unavailable: ${error instanceof Error ? error.message : String(error)}`,
      gradedAt: new Date().toISOString(),
    }
  }
}
