/**
 * POST /api/github/webhook — the grading and settlement signal for GitHub
 * repo jobs (docs/github-jobs.md, Phase 2).
 *
 * Three facts arrive here, and only these three matter:
 *   check_suite / check_run completed  → the requester's OWN CI verdict,
 *       written into `testResult` (the same field every other grader writes,
 *       so nothing downstream changes). CI green does NOT move money.
 *   pull_request merged                → the requester's approval. THIS is
 *       what releases the escrow (autoApprovePassedJob, authorization
 *       'merge').
 *   pull_request closed unmerged       → the dispute path: refund + repost
 *       for a different worker, exactly as a failed grade does.
 *
 * Every payload is HMAC-verified against the App's webhook secret before a
 * single byte of it is trusted. Unknown/unmatched deliveries are a 200 no-op:
 * GitHub retries non-2xx, and an installation on an unrelated repo is normal.
 */
import { db } from '@/lib/db'
import { jobSpec } from '@/lib/db/schema'
import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { origin as deploymentOrigin } from '@/lib/origin'
import {
  applyHskSettlementFact,
  evaluateHskRequiredChecks,
  hskCheckGateConfig,
  hskHackathonModeEnabled,
  isHskRepositoryAllowed,
  isHskRepositoryConfigured,
  isValidGithubSha,
  type HskCheckRun,
  type HskSettlementFact,
} from '@/lib/github-settlement-policy'

/**
 * Every spec ever minted from one GitHub issue, newest first.
 *
 * The two callers below both used to read the WHOLE job_specs table and take
 * the first JavaScript `.find` match, which is wrong twice over. Row order is
 * unspecified, and an issue can legitimately have several specs — label,
 * cancel, re-label, or a failed grade that auto-reposted. So `.find` could
 * return a long-dead job while a live one existed, which meant the
 * idempotency check below could pass and escrow a SECOND bounty for the same
 * issue, and the unlabel/close path could "cancel" the dead one and leave the
 * live escrow locked with no label left to release it.
 *
 * Scoped in SQL, ordered newest-first, and returning all candidates so the
 * caller decides against live chain state rather than against row order.
 */
async function specsForIssue(repoFullName: string, issueNumber: number) {
  return db
    .select({
      specHash: jobSpec.specHash,
      requesterAgentId: jobSpec.requesterAgentId,
      onchainJobId: jobSpec.onchainJobId,
    })
    .from(jobSpec)
    .where(
      and(
        eq(jobSpec.repoFullName, repoFullName),
        eq(jobSpec.issueNumber, issueNumber),
        isNotNull(jobSpec.onchainJobId),
      ),
    )
    .orderBy(desc(jobSpec.createdAt))
}

export const maxDuration = 300 // settlement runs on-chain UserOps

type Verdict = { passed: boolean | null; output: string; gradedAt: string }

export async function POST(request: Request) {
  const raw = await request.text()

  const { getGithubWebhookSecret, verifyGithubSignature } = await import('@/lib/github-app')
  const secret = await getGithubWebhookSecret()
  if (!secret) {
    console.error('[github/webhook] no webhook secret configured — rejecting delivery')
    return Response.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  if (!verifyGithubSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
    return Response.json({ error: 'Bad signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event') ?? ''
  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'Bad payload' }, { status: 400 })
  }

  const hskMode = hskHackathonModeEnabled()
  if (hskMode) {
    if (!hskCheckGateConfig()) {
      console.error('[github/webhook] HSK mode requires HSK_REQUIRED_CHECK_SUITE_APP_ID and HSK_REQUIRED_CHECK_NAMES')
      return Response.json({ error: 'HSK required-check configuration is missing or invalid' }, { status: 503 })
    }
    if (!isHskRepositoryConfigured()) {
      console.error('[github/webhook] HSK hackathon mode requires HSK_GITHUB_REPOSITORY')
      return Response.json({ error: 'HSK repository allowlist is not configured' }, { status: 503 })
    }
    const repoFullName = payload?.repository?.full_name
    if (!isHskRepositoryAllowed(repoFullName)) {
      return Response.json({ status: 'ignored', reason: 'repository is outside the HSK hackathon allowlist' })
    }
  }

  // Event-driven office sessions wake on this delivery, whoever handles the
  // rest of it. Best-effort and off the response path: a session tick can
  // take seconds, and GitHub's retry must never be a second wake.
  void wakeOfficeSessions(event, payload)

  try {
    if (event === 'pull_request') return await handlePullRequest(payload, hskMode)
    if (event === 'check_suite' || event === 'check_run') return await handleCheck(event, payload, hskMode)
    if (event === 'issues') {
      const res = await handleIssue(payload)
      // The bot's only observable output is a comment; when it stays silent we
      // need the exit path to be readable from the runtime logs.
      console.log(
        `[github/webhook] issues action=${String(payload?.action ?? '')} label=${String(payload?.label?.name ?? '')} -> ${await res.clone().text()}`,
      )
      return res
    }
    return Response.json({ status: 'ignored', event })
  } catch (error) {
    console.error(`[github/webhook] ${event} handling failed:`, error)
    // 500 so GitHub retries — settlement paths are all idempotent.
    return Response.json({ error: 'Handler failed' }, { status: 500 })
  }
}

async function wakeOfficeSessions(event: string, payload: unknown): Promise<void> {
  try {
    const { githubTriggersFor } = await import('@/lib/session-triggers')
    const fired = githubTriggersFor(event, payload)
    if (fired.length === 0) return
    const { fireSessionTriggers } = await import('@/lib/office-session-server')
    const n = await fireSessionTriggers(fired)
    if (n > 0) console.log(`[github/webhook] ${event} woke ${n} office session(s): ${fired.join(', ')}`)
  } catch (e) {
    console.error('[github/webhook] office-session trigger failed:', e)
  }
}

/** Find the job this PR belongs to. Repo + PR number is the whole key. */
async function specForPr(repoFullName: string, prNumber: number) {
  const [spec] = await db
    .select()
    .from(jobSpec)
    .where(and(eq(jobSpec.repoFullName, repoFullName), eq(jobSpec.prNumber, prNumber)))
  return spec ?? null
}

async function writeVerdict(specHash: string, verdict: Verdict, ciStatus: string | null) {
  await db
    .update(jobSpec)
    .set(ciStatus === null ? { testResult: verdict } : { testResult: verdict, ciStatus })
    .where(eq(jobSpec.specHash, specHash))
}

/**
 * Atomically fold the HSK demo's CI/merge facts into the existing JSON verdict.
 * jsonb field merging preserves a merge that races a check-suite delivery
 * without adding a database column or losing either webhook's evidence.
 */
async function writeHskSettlementFact(
  specHash: string,
  fact: HskSettlementFact,
  repoFullName: string,
  prNumber: number,
): Promise<{ accepted: boolean; settlementReady: boolean; ciPassed: boolean | null }> {
  const headSha = fact.headSha.toLowerCase()
  const now = new Date().toISOString()
  const eventOutput =
    fact.kind === 'ci'
      ? `Recorded completed CI suite ${fact.passed ? 'pass' : 'failure'} on ${repoFullName}#${prNumber} at ${headSha}. HSK demo payout requires CI success and merge of the same PR head.`
      : `Recorded requester merge of ${repoFullName}#${prNumber} at ${headSha}. HSK demo payout requires CI success and merge of the same PR head.`
  const current = sql`coalesce(${jobSpec.testResult}, '{}'::jsonb)`
  const delta = fact.kind === 'ci' ? { ci: { headSha, passed: fact.passed } } : { merge: { headSha } }
  const mergedResult = sql`jsonb_set(
    ${current},
    '{hskSettlement}',
    coalesce(${jobSpec.testResult}->'hskSettlement', '{}'::jsonb) || ${JSON.stringify(delta)}::jsonb,
    true
  )`
  const ci = sql`(${mergedResult}->'hskSettlement'->'ci')`
  const ciSha = sql`${ci}->>'headSha'`
  const mergeSha = sql`(${mergedResult}->'hskSettlement'->'merge'->>'headSha')`
  const passed = sql`case
    when ${ci}->>'passed' = 'true' and ${ciSha} = ${mergeSha} then 'true'::jsonb
    when ${ci}->>'passed' = 'false' and (${mergeSha} is null or ${ciSha} = ${mergeSha}) then 'false'::jsonb
    else 'null'::jsonb
  end`
  const testResult = sql`${mergedResult} || jsonb_build_object(
    'passed', ${passed},
    'output', ${eventOutput},
    'gradedAt', ${now}
  )`
  const mergedSha = sql`${jobSpec.testResult}->'hskSettlement'->'merge'->>'headSha'`
  const conditions = [eq(jobSpec.specHash, specHash)]
  if (fact.kind === 'ci') {
    // A CI delivery for a superseded head cannot overwrite the merged PR's
    // result, even if it was already in flight while the merge webhook ran.
    conditions.push(or(isNull(mergedSha), eq(mergedSha, headSha))!)
  }
  const values =
    fact.kind === 'ci'
      ? { testResult, ciStatus: fact.passed ? 'success' : 'failure' }
      : { testResult }
  const [updated] = await db
    .update(jobSpec)
    .set(values)
    .where(and(...conditions))
    .returning({ testResult: jobSpec.testResult })
  if (!updated) return { accepted: false, settlementReady: false, ciPassed: null }

  const folded = applyHskSettlementFact(updated.testResult, fact)
  return {
    accepted: folded.accepted,
    settlementReady: folded.settlementReady,
    ciPassed: folded.ciPassed,
  }
}

/** Read GitHub's latest check runs for the exact commit; webhook claims alone
 * cannot prove that every configured check in the demo finished successfully. */
async function verifyHskRequiredChecks(
  repoFullName: string,
  headSha: string,
  appId: number,
  requiredNames: string[],
) {
  const { installationTokenForRepo } = await import('@/lib/github-app')
  const token = await installationTokenForRepo(repoFullName)
  const encodedRepo = repoFullName.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(
    `https://api.github.com/repos/${encodedRepo}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'handsel-hsk-demo',
      },
    },
  )
  if (!response.ok) throw new Error(`GitHub required-check lookup failed with HTTP ${response.status}`)
  const body = (await response.json()) as { total_count?: number; check_runs?: HskCheckRun[] }
  if (!Number.isInteger(body.total_count) || !Array.isArray(body.check_runs)) {
    throw new Error('GitHub required-check lookup returned an invalid response')
  }
  return evaluateHskRequiredChecks(requiredNames, appId, headSha, body.check_runs, body.total_count!)
}


/**
 * The label-to-bounty bot: `bounty:$15` on a GitHub issue IS the job posting.
 *
 * labeled   → resolve the labeler through github_identities to a platform
 *             account (the GitHub sign-in is the identity bridge), escrow
 *             from their funded agent, post the repo job, comment back.
 *             Not linked → the comment carries the link instructions, so a
 *             failed label is an onboarding surface, not a silent no-op.
 * unlabeled / closed → cancel-and-refund, but ONLY while the job is still
 *             Open on-chain — a claimed job is a worker's committed work and
 *             a label cannot destroy it.
 *
 * Requires the App to hold Issues: Read & write and subscribe to Issue
 * events (docs/github-jobs.md). Idempotent per (repo, issue): re-delivered
 * webhooks find the existing open job and stop.
 */
async function handleIssue(payload: any): Promise<Response> {
  const action = String(payload?.action ?? '')
  const repoFullName = String(payload?.repository?.full_name ?? '')
  const { issueNumberOf, parseBountyLabel, bountyLabelOn } = await import('@/lib/bounty-label')
  const issueNumber = issueNumberOf(payload)
  if (!repoFullName || issueNumber === null) return Response.json({ status: 'ignored' })

  const origin = deploymentOrigin()
  const { commentOnPr } = await import('@/lib/github-app') // issues share the comments API with PRs

  if (action === 'labeled') {
    const bountyUsd = parseBountyLabel(String(payload?.label?.name ?? ''))
    if (bountyUsd === null) return Response.json({ status: 'ignored', reason: 'not a bounty label' })

    const { validateLabelBounty, briefFromIssue, bountyPostedComment, notLinkedComment } = await import('@/lib/bounty-label')
    const check = validateLabelBounty(bountyUsd)
    if (!check.ok) {
      await commentOnPr(repoFullName, issueNumber, `⚠️ ${check.reason}`)
      return Response.json({ status: 'rejected', reason: check.reason })
    }

    // Idempotency: one open job per (repo, issue) — and the check has to hold
    // for as long as the ESCROW takes, not just for the instant it runs.
    //
    // Posting a repo job is a ~30s ERC-4337 round trip. GitHub gives a webhook
    // ten seconds and redelivers when it doesn't hear back, so the natural
    // sequence is: delivery 1 checks (nothing live) → starts posting → GitHub
    // times out → delivery 2 arrives while the post is still in flight →
    // checks (still nothing live, because it hasn't landed) → posts a second
    // bounty. Neither check is wrong; they just both ran inside one gap. The
    // chain read being fresh would not have helped — nothing was there to
    // read yet.
    //
    // So hold a cross-instance lock on the issue across the whole post. Two
    // minutes covers the on-chain round trip with room to spare, and expires
    // on its own if this invocation dies mid-flight.
    const { acquireOpsLease, releaseOpsLease } = await import('@/lib/ops-lease')
    const issueLock = `bounty-issue:${repoFullName}#${issueNumber}`
    if (!(await acquireOpsLease(issueLock, 120_000))) {
      return Response.json({ status: 'ignored', reason: 'a bounty for this issue is already being escrowed' })
    }
    // Hand the lock back on every path that does NOT escrow. Most of them end
    // in "here is how to fix this" — and a user who fixes it re-labels within
    // seconds, which a two-minute lock would silently swallow.
    const unlock = async () => releaseOpsLease(issueLock)

    await (await import('@/lib/db/ensure-columns')).ensureJobSpecColumns()
    const existing = await specsForIssue(repoFullName, issueNumber)
    if (existing.length > 0) {
      const { readJobsOrUnknown } = await import('@/lib/onchain/labor-read')
      const jobs = await readJobsOrUnknown({ maxAgeMs: 0 })
      // An RPC hiccup here used to read as "nothing live for this issue" and
      // escrow a SECOND bounty. Unknown chain state is not permission to spend.
      if (jobs === null) {
        await unlock()
        await commentOnPr(repoFullName, issueNumber, `⚠️ Could not read the chain to check for an existing bounty — nothing was escrowed. Re-add the label to retry.`)
        return Response.json({ status: 'deferred', reason: 'chain state unknown' })
      }
      const statusById = new Map(jobs.map((j) => [j.id, j.status]))
      // ANY live job for this issue blocks a second escrow — not merely the
      // newest one, and not whichever row the database returned first.
      const { pickIssueJob } = await import('@/lib/bounty-label')
      const live = pickIssueJob(existing, (id) => statusById.get(id))
      if (live) {
        await unlock()
        return Response.json({ status: 'ignored', reason: `job #${live.jobId} already live for this issue` })
      }
    }

    // Identity bridge: the LABELER pays, resolved via their linked GitHub.
    const senderGithubId = String(payload?.sender?.id ?? '')
    const { userIdForGithubUser } = await import('@/lib/github-identity')
    const userId = senderGithubId ? await userIdForGithubUser(senderGithubId) : null
    if (!userId) {
      await unlock()
      await commentOnPr(repoFullName, issueNumber, notLinkedComment(origin))
      return Response.json({ status: 'rejected', reason: 'labeler not linked' })
    }
    const { agent } = await import('@/lib/db/schema')
    const agents = await db.select().from(agent).where(eq(agent.userId, userId))
    const requester = agents.find((a) => a.smartAccountAddress)
    if (!requester) {
      await unlock()
      await commentOnPr(repoFullName, issueNumber, `Your Handsel account has no provisioned agent to escrow from — create one at ${origin}/agents and re-add the label.`)
      return Response.json({ status: 'rejected', reason: 'no funded agent' })
    }

    try {
      const { postRepoJob } = await import('@/lib/repo-job-post')
      const issueTitle = String(payload?.issue?.title ?? `Issue #${issueNumber}`)
      const res = await postRepoJob({
        requesterAgentId: requester.id,
        repoFullName,
        title: issueTitle,
        brief: briefFromIssue({
          title: issueTitle,
          body: payload?.issue?.body ?? null,
          url: String(payload?.issue?.html_url ?? `https://github.com/${repoFullName}/issues/${issueNumber}`),
        }),
        issueUrl: String(payload?.issue?.html_url ?? ''),
        bountyUsd,
        issueNumber,
      })
      const [posted] = await db
        .select({ onchainJobId: jobSpec.onchainJobId })
        .from(jobSpec)
        .where(eq(jobSpec.specHash, res.specHash))
      const { isRealMoney } = await import('@/lib/onchain/real-money')
      await commentOnPr(
        repoFullName,
        issueNumber,
        bountyPostedComment({ bountyUsd, jobId: posted?.onchainJobId ?? null, origin, realMoney: isRealMoney() }),
      )
      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent('BOUNTY_LABELED', `A bounty label minted a $${bountyUsd} job from ${repoFullName}#${issueNumber}`).catch(() => {})
      return Response.json({ status: 'ok', posted: res.specHash })
    } catch (error) {
      // A PENDING post keeps the lock: the escrow was accepted by the bundler
      // and probably lands, so releasing here is how one label becomes two
      // bounties. A genuine failure releases, because the user will read the
      // comment and re-label within seconds.
      const { isUserOpPending } = await import('@/lib/onchain/account')
      if (isUserOpPending(error)) {
        console.warn(`[github/webhook] bounty post for ${repoFullName}#${issueNumber} is pending confirmation — holding the issue lock`)
        await commentOnPr(repoFullName, issueNumber, `⏳ Bounty escrow submitted — confirming on-chain. The job will appear on the board shortly.`)
        return Response.json({ status: 'pending' }, { status: 200 })
      }
      await unlock()
      const reason = error instanceof Error ? error.message : String(error)
      await commentOnPr(repoFullName, issueNumber, `⚠️ Could not escrow the bounty: ${reason.slice(0, 300)}`)
      return Response.json({ status: 'error', reason }, { status: 200 }) // 200: GitHub should not retry a semantic failure
    }
  }

  if (action === 'unlabeled' || action === 'closed') {
    // Only act when the bounty label is genuinely gone (unlabeled fires per
    // label; closed ends the intent regardless).
    if (action === 'unlabeled') {
      const removed = parseBountyLabel(String(payload?.label?.name ?? ''))
      if (removed === null) return Response.json({ status: 'ignored' })
      if (bountyLabelOn(payload?.issue?.labels) !== null) {
        return Response.json({ status: 'ignored', reason: 'another bounty label remains' })
      }
    }
    const candidates = await specsForIssue(repoFullName, issueNumber)
    if (candidates.length === 0) return Response.json({ status: 'ignored' })

    const { cancelJob } = await import('@/lib/onchain/labor')
    const { readJobsOrUnknown } = await import('@/lib/onchain/labor-read')
    const jobs = await readJobsOrUnknown({ maxAgeMs: 0 })
    // Swallowing the read here answered "no Open job for this issue", which
    // is a confident wrong answer to a question we could not see. `closed`
    // fires once and the label is already gone, so nothing would retry —
    // say what actually happened and leave it to the escrow sweeps.
    if (jobs === null) {
      return Response.json({ status: 'deferred', reason: 'chain state unknown — no refund attempted' })
    }
    const statusById = new Map(jobs.map((j) => [j.id, j.status]))
    // Refund the job that is ACTUALLY Open, whichever spec row it belongs to.
    // A claimed job is a worker's committed work — a label cannot destroy it.
    const { pickIssueJob } = await import('@/lib/bounty-label')
    const match = pickIssueJob(candidates, (id) => statusById.get(id), ['Open'])
    if (!match) {
      return Response.json({ status: 'ignored', reason: 'no Open job for this issue — a claimed job outlives its label' })
    }
    const { spec } = match
    if (!spec.requesterAgentId) return Response.json({ status: 'ignored', reason: 'no requester on record' })
    try {
      await cancelJob(spec.requesterAgentId, match.jobId)
      await commentOnPr(repoFullName, issueNumber, `↩️ Bounty cancelled and the escrow refunded (job was still unclaimed).`)
      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent('BOUNTY_UNLABELED', `Bounty on ${repoFullName}#${issueNumber} cancelled while unclaimed — escrow refunded`).catch(() => {})
      return Response.json({ status: 'ok', cancelled: spec.onchainJobId })
    } catch (error) {
      // A cancel whose receipt never arrived was still accepted by the
      // bundler and usually lands, so do not tell the issue it failed —
      // that reads as "your money is stuck" for a refund that is in flight.
      const { isUserOpPending } = await import('@/lib/onchain/account')
      if (isUserOpPending(error)) {
        console.warn(`[github/webhook] cancel of job ${spec.onchainJobId} is pending confirmation`)
        await commentOnPr(repoFullName, issueNumber, `↩️ Bounty cancelled — the refund is confirming on-chain.`)
        return Response.json({ status: 'pending', cancelled: spec.onchainJobId })
      }
      console.error('[github/webhook] bounty cancel failed:', error)
      return Response.json({ status: 'error' }, { status: 200 })
    }
  }

  return Response.json({ status: 'ignored' })
}

/**
 * Record the CI verdict on the WORKER'S credit ledger.
 *
 * `logPlatformEvent` only writes the cosmetic activity feed. The score comes
 * from `agent_events`, and every other grader — pytest, vision, transcription,
 * LLM review — inserts one there. Repo jobs did not, which meant the strongest
 * grader we have (the buyer's own CI, run on GitHub's infrastructure, where the
 * worker cannot reach it) contributed nothing to the credit score the whole
 * platform is built on. A worker could pass CI forever and stay "no graded work
 * yet".
 *
 * Idempotent: webhooks are re-delivered, and check_suite and check_run can both
 * fire for one result, so the event id is derived from the job and skipped if
 * already present.
 */
async function recordCiCreditEvent(
  spec: typeof jobSpec.$inferSelect,
  passed: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!spec.workerAgentId || spec.onchainJobId === null) return
  try {
    // Stamp the requester's current score for credibility weighting.
    if (spec.requesterAgentId && detail.requesterScore === undefined) {
      const { agent } = await import('@/lib/db/schema')
      const [req] = await db.select({ creditScore: agent.creditScore }).from(agent).where(eq(agent.id, spec.requesterAgentId))
      detail.requesterScore = req ? Number(req.creditScore) : null
    }
    const { agentEvent } = await import('@/lib/db/schema')
    const taskId = `job-${spec.onchainJobId}-ci`
    const existing = await db.select({ id: agentEvent.id }).from(agentEvent).where(eq(agentEvent.taskId, taskId))
    if (existing.length > 0) return

    const { nanoid } = await import('nanoid')
    await db.insert(agentEvent).values({
      id: nanoid(),
      agentId: spec.workerAgentId,
      taskId,
      eventType: passed ? 'JOB_TESTS_PASSED' : 'JOB_TESTS_FAILED',
      success: passed,
      executionTime: 0,
      tokenCost: 0,
      qualityScore: passed ? '1.000' : '0.000', // a graded fact, not self-assessment
      detail,
    })
    const { recalculateCredit } = await import('@/lib/credit-engine')
    await recalculateCredit(spec.workerAgentId)
  } catch (error) {
    console.error('[github/webhook] recording the CI credit event failed (non-fatal):', error)
  }
}

async function handleCheck(event: string, payload: any, hskMode = false) {
  const repoFullName: string | undefined = payload?.repository?.full_name
  const node = event === 'check_suite' ? payload?.check_suite : payload?.check_run
  if (!repoFullName || payload?.action !== 'completed' || !node) return Response.json({ status: 'ignored' })

  // check_run carries its PRs on the run; check_suite on the suite.
  const prs: Array<{ number: number }> = node.pull_requests ?? node.check_suite?.pull_requests ?? []
  const conclusion: string = node.conclusion ?? ''

  // A failing check on a commit that is not a Handsel job is not a verdict —
  // it is a NEW defect, and (if the repo opted in) a bounty to fix it. This
  // runs even with no PR: a red default branch is the purest case. It has to
  // know whether any PR here is a Handsel job first, because a failing check on
  // a worker's fix attempt is grading, not origination — so it goes after the
  // grading loop, which sets `gradedAHandselJob`.
  let gradedAHandselJob = false

  let handled = 0
  for (const pr of prs) {
    const spec = await specForPr(repoFullName, pr.number)
    if (!spec) {
      // Not a market job — the other lane a PR on this repo can belong to
      // is an office session's Repo Care (docs/repo-care.md), which posts
      // no jobSpec (settlement is `internal`). Fold the same verdict into
      // its task instead, so the morning report knows what GitHub actually
      // decided rather than just that a PR opened.
      await maybeRecordRepoCareCi(repoFullName, pr.number, event, node, conclusion).catch((e) =>
        console.error('[github/webhook] repo-care CI readback failed (non-fatal):', e),
      )
      continue
    }
    gradedAHandselJob = true

    let hskSettlementReady = false
    if (hskMode) {
      // A completed check suite is GitHub's aggregate result. A single
      // successful check_run is insufficient while sibling checks may still
      // be pending or failing.
      if (event !== 'check_suite') continue
      const linkedHeadSha = String((pr as any)?.head?.sha ?? '')
      const suiteHeadSha = String(node?.head_sha ?? '')
      if (!isValidGithubSha(linkedHeadSha) || !isValidGithubSha(suiteHeadSha)) continue
      if (linkedHeadSha.toLowerCase() !== suiteHeadSha.toLowerCase()) continue
      if (conclusion !== 'success' && conclusion !== 'failure' && conclusion !== 'timed_out') continue
      const gateConfig = hskCheckGateConfig()
      if (!gateConfig || node?.app?.id !== gateConfig.suiteAppId) continue
      const checkVerdict = await verifyHskRequiredChecks(
        repoFullName,
        suiteHeadSha,
        gateConfig.suiteAppId,
        gateConfig.requiredNames,
      )
      if (checkVerdict.state === 'pending') continue
      const checksPassed = conclusion === 'success' && checkVerdict.state === 'success'

      const strictResult = await writeHskSettlementFact(
        spec.specHash,
        { kind: 'ci', headSha: suiteHeadSha, passed: checksPassed },
        repoFullName,
        pr.number,
      )
      if (!strictResult.accepted) continue
      hskSettlementReady = strictResult.settlementReady
    }

    if (conclusion === 'success') {
      // Green CI is the independent verdict — recorded, and announced on the
      // PR — but the money waits for the merge.
      if (!hskMode) {
        await writeVerdict(
          spec.specHash,
          {
            passed: true,
            output: `CI passed on ${repoFullName}#${pr.number} (${event} conclusion: success). The escrow releases when the requester merges.`,
            gradedAt: new Date().toISOString(),
          },
          'success',
        )
      }
      const { commentOnPr } = await import('@/lib/github-app')
      await commentOnPr(
        repoFullName,
        pr.number,
        (hskMode && hskSettlementReady
          ? `✅ CI is green on the merged PR head. The HSK settlement attempt has started. `
          : `✅ CI is green. Merging this pull request releases the escrowed bounty to the worker; closing it unmerged refunds it. `) +
          `— [Handsel](${deploymentOrigin()}) job #${spec.onchainJobId}`,
      )
      if (hskMode && hskSettlementReady) {
        const fresh = await specForPr(repoFullName, pr.number)
        const { autoApprovePassedJob } = await import('@/lib/labor-settle')
        if (fresh) await autoApprovePassedJob(fresh, { authorization: 'merge' })
      }
      await recordCiCreditEvent(spec, true, {
        jobId: spec.onchainJobId,
        repo: repoFullName,
        prNumber: pr.number,
        grader: 'repo-ci',
        requesterAgentId: spec.requesterAgentId ?? null,
        conclusion,
      })
      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent(
        'JOB_TESTS_PASSED',
        hskMode && hskSettlementReady
          ? `"${spec.title}" — CI passed on the merged PR head #${pr.number}; HSK settlement attempt started`
          : `"${spec.title}" — the repository's own CI passed on PR #${pr.number}; awaiting the requester's merge to release escrow`,
      ).catch(() => {})
      handled++
    } else if (conclusion === 'failure' || conclusion === 'timed_out' || (hskMode && conclusion === 'success')) {
      // The requester's own grader failed the work: an objective verdict, so
      // the standard failure path runs — close the PR, refund, repost for a
      // different worker.
      if (!hskMode) {
        await writeVerdict(
          spec.specHash,
          {
            passed: false,
            output: `CI failed on ${repoFullName}#${pr.number} (${event} conclusion: ${conclusion}). The repository's own checks are the grader for repo jobs.`,
            gradedAt: new Date().toISOString(),
          },
          'failure',
        )
      }
      await recordCiCreditEvent(spec, false, {
        jobId: spec.onchainJobId,
        repo: repoFullName,
        prNumber: pr.number,
        grader: 'repo-ci',
        requesterAgentId: spec.requesterAgentId ?? null,
        conclusion,
      })
      const { commentOnPr } = await import('@/lib/github-app')
      await commentOnPr(
        repoFullName,
        pr.number,
        `❌ CI failed, so this attempt did not earn the bounty. The escrow is being refunded and the job reposted for a different worker.`,
      )
      const fresh = await specForPr(repoFullName, pr.number)
      const { returnFailedJobToMarket } = await import('@/lib/labor-settle')
      if (fresh) await returnFailedJobToMarket(fresh)
      handled++
    }
    // neutral / skipped / cancelled / action_required: not a verdict — ignore.
  }

  // Origination: a red check → a bounty to fix it, if the repo authorised it.
  // Only check_run carries a single check name; check_suite aggregates many, so
  // there is no one signature to dedup on and origination is a no-op there.
  const originated =
    event === 'check_run'
      ? await maybeOriginateCiBounty({
          repoFullName,
          checkName: String(node?.name ?? ''),
          conclusion,
          headSha: String(node?.head_sha ?? ''),
          runUrl: String(node?.html_url ?? ''),
          gradedAHandselJob,
        })
      : { status: 'skipped', reason: 'not a check_run' }

  return Response.json({ status: 'ok', handled, originated })
}

/**
 * The CI-readback bridge for Repo Care (`docs/repo-care.md`'s "CI is not
 * read back" gap): a check_suite/check_run completion on a PR that is not
 * a market job is checked against `office_session_repo_care` instead, and
 * a real success/failure conclusion is folded onto the task that opened
 * the PR. Neutral/skipped/action_required/stale carry no verdict, same as
 * the market lane above.
 */
async function maybeRecordRepoCareCi(repoFullName: string, prNumber: number, event: string, node: any, conclusion: string): Promise<void> {
  let passed: boolean | null = null
  if (conclusion === 'success') passed = true
  else if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled') passed = false
  if (passed === null) return

  const { findRepoCareTaskForPr, recordPrCiVerdict } = await import('@/lib/office-session-server')
  const hit = await findRepoCareTaskForPr(repoFullName, prNumber)
  if (!hit) return

  const checkUrl: string | null = typeof node?.html_url === 'string' ? node.html_url : null
  const dedupeKey = `${event}:${node?.id ?? `${conclusion}:${String(node?.head_sha ?? '')}`}`
  await recordPrCiVerdict({ sessionId: hit.sessionId, taskId: hit.taskId, prNumber, passed, conclusion, checkUrl, dedupeKey })
}

/**
 * A failing check becomes a funded fix-job — or, far more often, does not.
 *
 * The default is no spend: without a `ci_bounty_policies` row for the repo this
 * returns before touching a wallet. `decideAutoBounty` (lib/ci-bounty.ts) is the
 * authority; everything here is the plumbing that gives it honest inputs — the
 * live open-bounty check and the day's spend — and the lease that stops one red
 * check, redelivered, from escrowing twice (the exact race the label bot hit).
 */
async function maybeOriginateCiBounty(input: {
  repoFullName: string
  checkName: string
  conclusion: string
  headSha: string
  runUrl: string
  gradedAHandselJob: boolean
}): Promise<{ status: string; reason?: string; jobSpec?: string }> {
  const { repoFullName, checkName, conclusion, headSha, runUrl, gradedAHandselJob } = input
  const { isFailingConclusion, ciFailureSignature, decideAutoBounty, ciBountyBrief } = await import('@/lib/ci-bounty')

  // Cheapest rejections first, before any DB or chain read.
  if (!checkName || !isFailingConclusion(conclusion)) {
    return { status: 'skipped', reason: 'not a failing named check' }
  }

  const { ensureCiBountyTable } = await import('@/lib/db/ensure-columns')
  await ensureCiBountyTable()
  const { ciBountyPolicy, jobSpec: jobSpecTable } = await import('@/lib/db/schema')
  const [policyRow] = await db.select().from(ciBountyPolicy).where(eq(ciBountyPolicy.repoFullName, repoFullName))
  const policy = policyRow
    ? {
        repoFullName: policyRow.repoFullName,
        funderAgentId: policyRow.funderAgentId,
        bountyUsd: parseFloat(policyRow.bountyUsd),
        dailyCapUsd: parseFloat(policyRow.dailyCapUsd),
        enabled: policyRow.enabled,
      }
    : null

  const signature = ciFailureSignature(repoFullName, checkName)

  // Open-bounty dedup and today's spend, both read live rather than assumed.
  // An unreadable chain here must NOT read as "nothing open" — that is how a
  // second escrow lands (§the label bot's own lesson). Treat unknown as "an
  // open bounty might exist" and skip: refusing to spend on doubt is the safe
  // direction.
  let openBountyExists = true
  let spentTodayUsd = 0
  try {
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const rows = await db
      .select({ id: jobSpecTable.onchainJobId, sig: jobSpecTable.ciCheckSignature, created: jobSpecTable.createdAt })
      .from(jobSpecTable)
      .where(and(eq(jobSpecTable.repoFullName, repoFullName), isNotNull(jobSpecTable.ciCheckSignature)))
    const { readJobsOrUnknown } = await import('@/lib/onchain/labor-read')
    const jobs = await readJobsOrUnknown({ maxAgeMs: 0 })
    if (jobs === null) return { status: 'deferred', reason: 'chain state unknown — no bounty originated' }
    // The amount lives on-chain, not in the spec row — the spec never stores a
    // price because the live bounty can rise (Dutch auction). So spend is
    // summed from the chain's own bounty, matched by onchain job id.
    const statusById = new Map(jobs.map((j) => [j.id, j.status]))
    const bountyById = new Map(jobs.map((j) => [j.id, j.bounty]))

    openBountyExists = rows.some(
      (r) => r.sig === signature && r.id !== null && statusById.get(r.id) === 'Open',
    )
    spentTodayUsd = rows
      .filter((r) => r.created && r.created >= dayStart && r.id !== null)
      .reduce((sum, r) => sum + (bountyById.get(r.id!) ?? 0), 0)
  } catch (error) {
    console.error('[ci-bounty] pre-post read failed — not originating:', error)
    return { status: 'error', reason: 'pre-post read failed' }
  }

  const decision = decideAutoBounty({ policy, conclusion, isHandselJobPr: gradedAHandselJob, openBountyExists, spentTodayUsd })
  if (!decision.post) return { status: 'skipped', reason: decision.reason }

  // One in-flight origination per signature, mirroring the issue lock: a
  // redelivered webhook must not escrow twice while the first post is landing.
  const { acquireOpsLease, releaseOpsLease } = await import('@/lib/ops-lease')
  const lock = `ci-bounty:${signature}`
  if (!(await acquireOpsLease(lock, 120_000))) {
    return { status: 'ignored', reason: 'a bounty for this check is already being escrowed' }
  }

  try {
    const { postRepoJob } = await import('@/lib/repo-job-post')
    const res = await postRepoJob({
      requesterAgentId: policy!.funderAgentId,
      repoFullName,
      title: `Fix failing check: ${checkName}`,
      brief: ciBountyBrief({ repoFullName, checkName, runUrl, headSha }),
      bountyUsd: decision.bountyUsd,
      ciCheckSignature: signature,
    })
    const { logPlatformEvent } = await import('@/lib/platform-feed')
    await logPlatformEvent(
      'CI_BOUNTY_POSTED',
      `A red check "${checkName}" on ${repoFullName} minted a $${decision.bountyUsd} fix bounty`,
    ).catch(() => {})
    return { status: 'ok', jobSpec: res.specHash }
  } catch (error) {
    // A pending post KEEPS the lock — the escrow probably landed, and releasing
    // is how one red check becomes two bounties. A real failure releases.
    const { isUserOpPending } = await import('@/lib/onchain/account')
    if (isUserOpPending(error)) {
      console.warn(`[ci-bounty] post for ${signature} is pending — holding the lock`)
      return { status: 'pending' }
    }
    await releaseOpsLease(lock)
    console.error('[ci-bounty] origination post failed:', error)
    return { status: 'error', reason: error instanceof Error ? error.message : String(error) }
  }
}

async function handlePullRequest(payload: any, hskMode = false) {
  const repoFullName: string | undefined = payload?.repository?.full_name
  const prNumber: number | undefined = payload?.pull_request?.number
  if (!repoFullName || !prNumber || payload?.action !== 'closed') return Response.json({ status: 'ignored' })

  const spec = await specForPr(repoFullName, prNumber)
  if (!spec) return Response.json({ status: 'ignored', reason: 'no job for this PR' })

  const merged = Boolean(payload?.pull_request?.merged)
  const { logPlatformEvent } = await import('@/lib/platform-feed')

  if (merged) {
    if (hskMode) {
      const headSha = String(payload?.pull_request?.head?.sha ?? '')
      if (!isValidGithubSha(headSha)) {
        return Response.json({ status: 'ignored', reason: 'merged PR head SHA is missing or invalid' })
      }
      const strictResult = await writeHskSettlementFact(
        spec.specHash,
        { kind: 'merge', headSha },
        repoFullName,
        prNumber,
      )
      if (!strictResult.accepted) return Response.json({ status: 'ignored', reason: 'could not record merge fact' })

      let settlementAttempted = false
      if (strictResult.settlementReady) {
        const fresh = await specForPr(repoFullName, prNumber)
        const { autoApprovePassedJob } = await import('@/lib/labor-settle')
        if (fresh) {
          await autoApprovePassedJob(fresh, { authorization: 'merge' })
          settlementAttempted = true
        }
      }
      const settlement = strictResult.settlementReady
        ? 'ready'
        : strictResult.ciPassed === false
          ? 'blocked-ci-failed'
          : 'waiting-for-ci'
      await logPlatformEvent(
        'REPO_JOB_MERGED',
        strictResult.settlementReady
          ? `"${spec.title}" — PR #${prNumber} merged and its exact head passed CI on ${repoFullName}; settlement attempt started`
          : `"${spec.title}" — PR #${prNumber} merged on ${repoFullName}; escrow is held until its exact head passes CI`,
      ).catch(() => {})
      return Response.json({ status: 'ok', settlement, settlementAttempted })
    }

    // The requester merged: their own, first-party approval of this work.
    // Record it as the verdict (a merge outranks any grader) and release.
    await writeVerdict(
      spec.specHash,
      {
        passed: true,
        output: `The requester merged ${repoFullName}#${prNumber} — the work was accepted into the repository.`,
        gradedAt: new Date().toISOString(),
      },
      // Deliberately null: the merge is already recorded in testResult and in
      // the on-chain status. Writing 'merged' into ciStatus overwrote what CI
      // actually said, so a merged job reported "no CI result yet" — the audit
      // trail lost the verdict at the exact moment it mattered most.
      null,
    )
    const fresh = await specForPr(repoFullName, prNumber)
    const { autoApprovePassedJob } = await import('@/lib/labor-settle')
    if (fresh) await autoApprovePassedJob(fresh, { authorization: 'merge' })
    await logPlatformEvent(
      'REPO_JOB_MERGED',
      `"${spec.title}" — PR #${prNumber} merged on ${repoFullName}; escrow released to the worker`,
    ).catch(() => {})
    return Response.json({ status: 'ok', settled: 'merged' })
  }

  // Closed without merging = rejected. Same semantics as a failed grade.
  await writeVerdict(
    spec.specHash,
    {
      passed: false,
      output: `The requester closed ${repoFullName}#${prNumber} without merging — the work was not accepted.`,
      gradedAt: new Date().toISOString(),
    },
    'closed',
  )
  const fresh = await specForPr(repoFullName, prNumber)
  const { returnFailedJobToMarket } = await import('@/lib/labor-settle')
  if (fresh) await returnFailedJobToMarket(fresh)
  await logPlatformEvent(
    'REPO_JOB_REJECTED',
    `"${spec.title}" — PR #${prNumber} closed unmerged on ${repoFullName}; escrow refunded and the job reposted`,
  ).catch(() => {})
  return Response.json({ status: 'ok', settled: 'closed' })
}
