import { githubAppChecks, houseChecks, emailCheck } from '@/lib/github-doctor'

/**
 * GET /api/doctor — machine-readable platform health for the GitHub-jobs
 * pipeline. Everything here is either public App metadata (GitHub serves the
 * event list on the App's public page) or aggregate delivery counts; no
 * repository names, no secret material, no per-user data (the signed-in
 * agent view lives on the /doctor page, behind the session).
 */
export async function GET() {
  const [github, house] = await Promise.all([githubAppChecks(), houseChecks()])
  const checks = [...github, ...house, emailCheck()]
  const worst = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass'
  return Response.json({ status: worst, checks, checkedAt: new Date().toISOString() })
}
