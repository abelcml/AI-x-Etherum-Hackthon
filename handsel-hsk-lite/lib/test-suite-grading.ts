/**
 * Mutation grading for test-suite jobs (lib/test-suite-jobs.ts): run the
 * submitted asserts against the hidden reference (must pass) and every hidden
 * mutant (must fail), on the SAME platform-runtime /grade sandbox the code
 * grader uses — gradeSubmission(solution, tests) with the roles inverted.
 * Mechanical end to end; grader ≠ solver by construction.
 */
import { extractPythonCode, gradeSubmission, type GradeOutcome } from '@/lib/code-grading'
import { judgeTestSuite, type TestSuiteSpec } from '@/lib/test-suite-jobs'

export async function gradeTestSuiteSubmission(spec: TestSuiteSpec, workerOutput: string): Promise<GradeOutcome> {
  const gradedAt = new Date().toISOString()
  const tests = extractPythonCode(workerOutput)
  if (!tests) {
    return { passed: false, output: 'No Python code block found in the submission.', gradedAt }
  }

  // Sequential on purpose: the runtime sandbox is a shared resource, and a
  // suite is at most 1 + |mutants| short runs.
  const reference = await gradeSubmission(spec.referenceSolution, tests)
  const mutantResults: (boolean | null)[] = []
  for (const mutant of spec.mutants) {
    const r = await gradeSubmission(mutant.code, tests)
    mutantResults.push(r.passed)
  }

  const verdict = judgeTestSuite(reference.passed, mutantResults)
  return { passed: verdict.passed, output: verdict.output, gradedAt }
}
