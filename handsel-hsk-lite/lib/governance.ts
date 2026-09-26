/**
 * Governance — $LEDGER token, ve-lockup, and proposal voting.
 *
 * Off-chain ledger v1 (Snapshot-style, testnet). Two deliberate design
 * choices:
 *  - $LEDGER is EARNED from real contribution (completed work), never
 *    bought, so voting weight tracks genuine platform usage rather than
 *    capital — no plutocracy-by-purchase.
 *  - Vote-escrow (ve): you lock $LEDGER for a chosen duration and get
 *    voting power proportional to amount × remaining-lock-fraction. Longer
 *    commitment = more say per token; power decays linearly to zero at
 *    unlock. Locked tokens can't be re-locked or spent until they expire.
 *
 * v1 is signaling governance: a passed proposal directs the operator, who
 * executes manually. The pure math (ve decay, tally) is isolated and unit-
 * tested — it's what makes votes fair.
 */
import { db } from '@/lib/db'
import { agent, govAccount, govLock, govProposal, govVote, govDelegateReview, govOnchainVote } from '@/lib/db/schema'
import { and, eq, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export const LEDGER_PER_COMPLETED_JOB = 10
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const MIN_LOCK_WEEKS = 1
export const MAX_LOCK_WEEKS = 52
export const PROPOSAL_MIN_POWER = 10 // ve power needed to open a proposal
export const DEFAULT_PROPOSAL_DAYS = 7
export const QUORUM_POWER = 50 // min total power cast for a result to count
// Auto-voting eligibility is a PERSONAL-trust decision, not a platform-trust
// one: the owner opts in and sets a stance — that IS the authorization.
// Credit score (a labor-market performance signal) is deliberately NOT a
// gate here; conflating "good at completing jobs" with "may vote on my
// behalf" was a category error. Credit only breaks ties when an owner has
// several delegates enabled (see pickDelegateByUser).
// A delegate must be at least this confident to auto-cast. Below it — or if
// the proposal could harm the least-advantaged — the recommendation is
// escalated to the owner instead of cast. Borrowed from the algorithmica
// auto-voter's human-in-the-loop guardrail. (0–1 scale.)
export const CONFIDENCE_THRESHOLD = 0.7

export type VoteChoice = 'for' | 'against' | 'abstain'

/** A delegate's structured recommendation for one proposal. */
export interface DelegateDecision {
  choice: VoteChoice
  confidence: number // 0–1
  rationale: string
  /** The delegate's own call that a human should decide this one. */
  escalate: boolean
  /** High minority-impact — harms the least-advantaged / small participants. */
  minorityImpactHigh: boolean
}

/** The escalation gate, kept pure so it's unit-tested: a decision goes to
 *  human review if the delegate asked to escalate, OR it's high-minority-
 *  impact, OR it's below the confidence floor. Server-enforced — the model
 *  can never suppress it by omitting a flag. */
export function mustEscalate(d: DelegateDecision, threshold = CONFIDENCE_THRESHOLD): boolean {
  return d.escalate || d.minorityImpactHigh || d.confidence < threshold
}

/** Human-readable reason for an escalation (drives the review card). */
export function escalationReason(d: DelegateDecision, threshold = CONFIDENCE_THRESHOLD): string {
  if (d.minorityImpactHigh) return 'Could significantly harm the least-advantaged — a human should decide.'
  if (d.confidence < threshold) return `Low confidence (${(d.confidence * 100).toFixed(0)}%) — below the ${(threshold * 100).toFixed(0)}% auto-vote floor.`
  return 'The delegate flagged this for your judgment.'
}

// ---------- pure math (unit-tested) ----------

/** Voting power of a single lock at time `now`. Linear ve decay:
 *  amount × (unlockAt − now) / MAX_LOCK, clamped to [0, amount]. A fully
 *  MAX_LOCK-long lock starts at ~amount and bleeds to 0 at unlock. */
export function lockVotingPower(lock: { amount: number; unlockAt: number }, now: number): number {
  const remaining = lock.unlockAt - now
  if (remaining <= 0) return 0
  const maxMs = MAX_LOCK_WEEKS * WEEK_MS
  return Math.min(lock.amount, (lock.amount * remaining) / maxMs)
}

/** Total voting power over a set of active locks. */
export function totalVotingPower(locks: { amount: number; unlockAt: number }[], now: number): number {
  return locks.reduce((sum, l) => sum + lockVotingPower(l, now), 0)
}

export interface Tally {
  for: number
  against: number
  abstain: number
  total: number
  quorumMet: boolean
  passed: boolean
}

/** Tally weighted votes into a result. Passes iff quorum is met AND `for`
 *  strictly outweighs `against` (abstain counts toward quorum only). */
export function tallyVotes(votes: { choice: VoteChoice; power: number }[]): Tally {
  const t = { for: 0, against: 0, abstain: 0 }
  for (const v of votes) t[v.choice] += v.power
  const total = t.for + t.against + t.abstain
  const quorumMet = total >= QUORUM_POWER
  return { ...t, total, quorumMet, passed: quorumMet && t.for > t.against }
}

export interface AutoVoteAgent {
  id: string
  userId: string
  creditScore: number
  votePolicy: string | null
  autoVote: boolean
}

/** May this agent auto-vote as its owner's delegate? Purely the owner's
 *  call: the opt-in flag plus a non-empty stance (we never fabricate a
 *  position for an agent that has none). Credit score is NOT a factor —
 *  that's a labor-market signal, unrelated to who the owner trusts to vote. */
export function isAutoVoteEligible(a: AutoVoteAgent): boolean {
  return a.autoVote && !!a.votePolicy && a.votePolicy.trim().length > 0
}

/** One vote per owner per proposal — so a user with several enabled agents
 *  gets a single delegate. Credit score is only a deterministic tie-break
 *  (a stable pick, NOT a gate). Pure so it's unit-tested. */
export function pickDelegateByUser(agents: AutoVoteAgent[]): Map<string, AutoVoteAgent> {
  const byUser = new Map<string, AutoVoteAgent>()
  for (const a of agents) {
    if (!isAutoVoteEligible(a)) continue
    const cur = byUser.get(a.userId)
    if (!cur || a.creditScore > cur.creditScore) byUser.set(a.userId, a)
  }
  return byUser
}

// ---------- ledger ops ----------

async function ensureAccount(userId: string) {
  const [acct] = await db.select().from(govAccount).where(eq(govAccount.userId, userId))
  if (acct) return acct
  await db.insert(govAccount).values({ userId, balance: '0', totalEarned: '0' }).onConflictDoNothing()
  const [created] = await db.select().from(govAccount).where(eq(govAccount.userId, userId))
  return created
}

/** Credit $LEDGER to an account (earned from contribution). Best-effort:
 *  a governance-ledger failure must never break the job-completion path
 *  that calls it. */
export async function earnLedger(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  try {
    await ensureAccount(userId)
    await db
      .update(govAccount)
      .set({
        balance: sql`${govAccount.balance} + ${amount}`,
        totalEarned: sql`${govAccount.totalEarned} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(govAccount.userId, userId))
  } catch (error) {
    console.error('[governance] earnLedger failed (non-fatal):', error)
  }
}

/** Lock `amount` for `weeks` — moves it out of spendable balance into a ve
 *  lock. Throws on insufficient balance or out-of-range duration. */
export async function createLock(userId: string, amount: number, weeks: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive')
  if (!Number.isInteger(weeks) || weeks < MIN_LOCK_WEEKS || weeks > MAX_LOCK_WEEKS) {
    throw new Error(`Lock duration must be ${MIN_LOCK_WEEKS}–${MAX_LOCK_WEEKS} weeks`)
  }
  const acct = await ensureAccount(userId)
  if (Number(acct.balance) < amount) throw new Error(`Insufficient $LEDGER (have ${Number(acct.balance)}, need ${amount})`)

  await db
    .update(govAccount)
    .set({ balance: sql`${govAccount.balance} - ${amount}`, updatedAt: new Date() })
    .where(eq(govAccount.userId, userId))
  await db.insert(govLock).values({
    id: `lock-${nanoid(12)}`,
    userId,
    amount: amount.toFixed(6),
    unlockAt: new Date(Date.now() + weeks * WEEK_MS),
  })
}

/** Return expired locks' principal to spendable balance. Idempotent —
 *  safe to call from any governance read. */
export async function withdrawExpiredLocks(userId: string): Promise<number> {
  const now = new Date()
  const expired = await db
    .select()
    .from(govLock)
    .where(and(eq(govLock.userId, userId), eq(govLock.withdrawn, false)))
  let returned = 0
  for (const lock of expired) {
    if (lock.unlockAt > now) continue
    await db.update(govLock).set({ withdrawn: true }).where(eq(govLock.id, lock.id))
    await db
      .update(govAccount)
      .set({ balance: sql`${govAccount.balance} + ${Number(lock.amount)}`, updatedAt: new Date() })
      .where(eq(govAccount.userId, userId))
    returned += Number(lock.amount)
  }
  return returned
}

export interface GovSummary {
  balance: number
  totalEarned: number
  locked: number
  votingPower: number
  locks: { id: string; amount: number; unlockAt: string; power: number }[]
}

/** Full governance position for an account (drives the /governance page). */
export async function govSummary(userId: string): Promise<GovSummary> {
  await withdrawExpiredLocks(userId)
  const acct = await ensureAccount(userId)
  const activeLocks = (
    await db.select().from(govLock).where(and(eq(govLock.userId, userId), eq(govLock.withdrawn, false)))
  ).filter((l) => l.unlockAt > new Date())
  const now = Date.now()
  const locks = activeLocks.map((l) => ({
    id: l.id,
    amount: Number(l.amount),
    unlockAt: l.unlockAt.toISOString(),
    power: lockVotingPower({ amount: Number(l.amount), unlockAt: l.unlockAt.getTime() }, now),
  }))
  return {
    balance: Number(acct.balance),
    totalEarned: Number(acct.totalEarned),
    locked: locks.reduce((s, l) => s + l.amount, 0),
    votingPower: locks.reduce((s, l) => s + l.power, 0),
    locks,
  }
}

/** Current voting power for an account (for gating + vote weight). */
export async function currentVotingPower(userId: string): Promise<number> {
  const activeLocks = (
    await db.select().from(govLock).where(and(eq(govLock.userId, userId), eq(govLock.withdrawn, false)))
  ).filter((l) => l.unlockAt > new Date())
  const now = Date.now()
  return totalVotingPower(
    activeLocks.map((l) => ({ amount: Number(l.amount), unlockAt: l.unlockAt.getTime() })),
    now,
  )
}

// ---------- proposals & voting ----------

export async function createProposal(userId: string, title: string, body: string, days = DEFAULT_PROPOSAL_DAYS) {
  const t = title.trim()
  if (t.length < 8) throw new Error('Give the proposal a clear title (8+ characters)')
  const power = await currentVotingPower(userId)
  if (power < PROPOSAL_MIN_POWER) {
    throw new Error(`You need ≥ ${PROPOSAL_MIN_POWER} voting power to open a proposal (lock $LEDGER to gain it). You have ${power.toFixed(1)}.`)
  }
  const id = `prop-${nanoid(10)}`
  const closesAt = new Date(Date.now() + Math.max(1, Math.min(30, days)) * 24 * 60 * 60 * 1000)
  await db.insert(govProposal).values({ id, creatorUserId: userId, title: t, body: body.trim().slice(0, 5000), closesAt })

  // Best-effort: mirror to an on-chain commit-reveal poll when configured.
  // Commit window = until the proposal closes; reveal window = the days
  // after. Never blocks proposal creation.
  await mirrorProposalOnchain(id, userId, closesAt).catch(() => undefined)
  return { id }
}

/** Deploy the on-chain VeilPoll for a proposal (gated + best-effort). Uses
 *  one of the creator's smart-account agents as the relayer. Durations are
 *  relative: commit window = time until the proposal closes, reveal window =
 *  GOVERNANCE_REVEAL_DAYS after that. */
async function mirrorProposalOnchain(proposalId: string, userId: string, closesAt: Date): Promise<void> {
  const { isGovernanceOnchainConfigured, onchainEnv } = await import('@/lib/onchain/config')
  if (!isGovernanceOnchainConfigured()) return
  const [relayer] = await db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.userId, userId), sql`${agent.smartAccountAddress} is not null`))
    .limit(1)
  if (!relayer) return
  const commitDurationSec = Math.max(60, Math.floor((closesAt.getTime() - Date.now()) / 1000))
  const revealDurationSec = Math.max(1, onchainEnv.governanceRevealDays) * 24 * 60 * 60
  const { createOnchainPoll } = await import('@/lib/onchain/governance-poll')
  const pollAddress = await createOnchainPoll(relayer.id, commitDurationSec, revealDurationSec)
  if (pollAddress) {
    await db
      .update(govProposal)
      .set({ onchainPollAddress: pollAddress })
      .where(eq(govProposal.id, proposalId))
      .catch(() => undefined)
  }
}

/** Cast (or refuse to overwrite) a weighted vote. Power is snapshotted at
 *  cast time; votes are immutable so late lock-topping can't re-weight a
 *  ballot already counted. */
export async function castVote(
  userId: string,
  proposalId: string,
  choice: VoteChoice,
  opts: { viaAgentId?: string | null; rationale?: string | null; confidence?: number | null } = {},
) {
  const [prop] = await db.select().from(govProposal).where(eq(govProposal.id, proposalId))
  if (!prop) throw new Error('Proposal not found')
  if (prop.closesAt <= new Date()) throw new Error('Voting has closed on this proposal')

  const [existing] = await db
    .select()
    .from(govVote)
    .where(and(eq(govVote.proposalId, proposalId), eq(govVote.userId, userId)))
  if (existing) throw new Error('You already voted on this proposal')

  const power = await currentVotingPower(userId)
  if (power <= 0) throw new Error('You have no voting power — lock $LEDGER first')
  await db.insert(govVote).values({
    proposalId,
    userId,
    choice,
    power: power.toFixed(6),
    viaAgentId: opts.viaAgentId ?? null,
    rationale: opts.rationale ? opts.rationale.slice(0, 300) : null,
    confidence: opts.confidence != null ? Math.max(0, Math.min(1, opts.confidence)).toFixed(3) : null,
  })
  return { power }
}

// ---------- AI delegate auto-voting ----------

export interface VotingAgentView {
  id: string
  name: string
  creditScore: number
  autoVote: boolean
  votePolicy: string
}

/** The caller's agents with their delegate config (drives the delegate
 *  section of the /governance page). Every agent can be a delegate — it's
 *  the owner's call, not a credit gate. */
export async function listVotingAgents(userId: string): Promise<VotingAgentView[]> {
  const rows = await db
    .select({ id: agent.id, name: agent.name, creditScore: agent.creditScore, autoVote: agent.autoVote, votePolicy: agent.votePolicy })
    .from(agent)
    .where(eq(agent.userId, userId))
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    creditScore: Number(a.creditScore),
    autoVote: a.autoVote,
    votePolicy: a.votePolicy ?? '',
  }))
}

/** Enable/disable an agent as its owner's voting delegate. Owner-guarded;
 *  enabling only requires a stated policy — trusting the delegate is the
 *  owner's decision, so there is no credit-score gate. */
export async function setAutoVote(agentId: string, ownerUserId: string, enabled: boolean, policy: string) {
  const [a] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!a || a.userId !== ownerUserId) throw new Error('Agent not found')
  const trimmed = (policy ?? '').trim()
  if (enabled && !trimmed) {
    throw new Error('Set a voting policy so the delegate knows how to vote on your behalf')
  }
  await db
    .update(agent)
    .set({ autoVote: enabled, votePolicy: trimmed.slice(0, 2000), updatedAt: new Date() })
    .where(eq(agent.id, agentId))
  return { ok: true as const }
}

/** Ask an owner's LLM (BYOK, else platform key) how their delegate should
 *  vote. Two-hat single call (analyst then delegate), modeled on the
 *  algorithmica auto-voter: neutrally assess who's affected — especially the
 *  least-advantaged — THEN recommend per the owner's policy, with a
 *  self-reported confidence and an escalate flag. Returns null on any
 *  failure — auto-voting is strictly best-effort. */
async function decideDelegateVote(
  userId: string,
  policy: string,
  prop: { title: string; body: string },
): Promise<DelegateDecision | null> {
  let complete: (system: string, userMsg: string, maxTokens: number) => Promise<string>
  try {
    const { resolveLlm } = await import('@/lib/delegation')
    complete = await resolveLlm(userId)
  } catch {
    return null // no LLM key for this owner — skip, don't guess
  }
  const system =
    'You are an AI governance delegate voting on behalf of your owner in an AI-agent labor marketplace. ' +
    'First act as a neutral ANALYST: who is affected by this proposal, and could it harm the least-advantaged participants ' +
    '(new/small miners, low-credit agents, minority stakeholders)? Then act as the DELEGATE: recommend a vote that follows ' +
    "the owner's standing policy below — the policy is your mandate, not your own preferences. Be honest about uncertainty. " +
    'Output ONLY strict JSON: {"choice":"for"|"against"|"abstain","confidence":0.0-1.0,"rationale":"<=160 chars grounded in the policy",' +
    '"escalate":true|false,"minorityImpactHigh":true|false}. ' +
    'Set minorityImpactHigh=true if the proposal could significantly harm the least-advantaged. Set escalate=true whenever a human should decide. ' +
    'Use "abstain" when the policy does not clearly favor either side. No commentary, no code fences.'
  const userMsg = `OWNER VOTING POLICY:\n${policy}\n\nPROPOSAL TITLE: ${prop.title}\n\nPROPOSAL BODY:\n${prop.body || '(no description provided)'}`
  let raw: string
  try {
    raw = await complete(system, userMsg, 600)
  } catch {
    return null
  }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
    const choice = j?.choice
    if (choice !== 'for' && choice !== 'against' && choice !== 'abstain') return null
    const confidence = Number(j?.confidence)
    return {
      choice,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0, // unparseable confidence → 0 → escalates
      rationale: String(j?.rationale ?? '').slice(0, 200),
      escalate: j?.escalate === true,
      minorityImpactHigh: j?.minorityImpactHigh === true,
    }
  } catch {
    return null // unparseable — retry next tick rather than cast garbage
  }
}

/** Park an escalated recommendation for the owner to confirm/dismiss.
 *  Upsert so re-ticks refresh (never duplicate) a still-pending review. */
async function upsertReview(proposalId: string, userId: string, viaAgentId: string, d: DelegateDecision) {
  await db
    .insert(govDelegateReview)
    .values({
      proposalId,
      userId,
      viaAgentId,
      choice: d.choice,
      confidence: d.confidence.toFixed(3),
      rationale: d.rationale,
      reason: escalationReason(d),
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [govDelegateReview.proposalId, govDelegateReview.userId],
      set: { choice: d.choice, confidence: d.confidence.toFixed(3), rationale: d.rationale, reason: escalationReason(d) },
    })
    .catch(() => undefined)
}

/** Cast delegate votes for every eligible agent on every open proposal it
 *  hasn't handled yet. Confidence-gated: a low-confidence or minority-
 *  harming recommendation is parked for owner review (gov_delegate_reviews)
 *  rather than cast. Idempotent — a proposal already voted OR already under
 *  review triggers no new LLM call, so this is cheap on the heartbeat. */
export async function runAutoVotes(
  now = new Date(),
): Promise<{ openProposals: number; delegates: number; cast: number; escalated: number }> {
  const openProps = (await db.select().from(govProposal).where(eq(govProposal.status, 'open'))).filter(
    (p) => p.closesAt > now,
  )
  if (openProps.length === 0) return { openProposals: 0, delegates: 0, cast: 0, escalated: 0 }

  const rows = await db.select().from(agent).where(eq(agent.autoVote, true))
  const delegates = pickDelegateByUser(
    rows.map((a) => ({
      id: a.id,
      userId: a.userId,
      creditScore: Number(a.creditScore),
      votePolicy: a.votePolicy,
      autoVote: a.autoVote,
    })),
  )
  if (delegates.size === 0) return { openProposals: openProps.length, delegates: 0, cast: 0, escalated: 0 }

  let cast = 0
  let escalated = 0
  for (const prop of openProps) {
    for (const [userId, del] of delegates) {
      const [voted] = await db
        .select({ userId: govVote.userId })
        .from(govVote)
        .where(and(eq(govVote.proposalId, prop.id), eq(govVote.userId, userId)))
      if (voted) continue // already voted (manually or by a prior tick)
      const [reviewed] = await db
        .select({ userId: govDelegateReview.userId })
        .from(govDelegateReview)
        .where(
          and(
            eq(govDelegateReview.proposalId, prop.id),
            eq(govDelegateReview.userId, userId),
            eq(govDelegateReview.status, 'pending'),
          ),
        )
      if (reviewed) continue // already awaiting the owner — don't re-ask the LLM
      const power = await currentVotingPower(userId)
      if (power <= 0) continue // nothing locked → no weight to cast
      const decision = await decideDelegateVote(userId, del.votePolicy ?? '', {
        title: prop.title,
        body: prop.body,
      }).catch(() => null)
      if (!decision) continue

      if (mustEscalate(decision)) {
        await upsertReview(prop.id, userId, del.id, decision)
        escalated++
        continue // human-in-the-loop — never silently cast an uncertain/harmful vote
      }
      try {
        await castVote(userId, prop.id, decision.choice, {
          viaAgentId: del.id,
          rationale: decision.rationale,
          confidence: decision.confidence,
        })
        cast++
        // Also commit on-chain (privacy-preserving) when configured — the
        // off-chain vote above stays the authoritative ve-weighted tally.
        if (prop.onchainPollAddress) {
          await commitDelegateVoteOnchain(prop.id, userId, del.id, prop.onchainPollAddress, decision.choice).catch(
            () => undefined,
          )
        }
      } catch {
        // raced with a manual vote or the window just closed — fine, skip.
      }
    }
  }
  return { openProposals: openProps.length, delegates: delegates.size, cast, escalated }
}

/** Commit a delegate's vote on-chain from its smart account (gated + best-
 *  effort). Stores the salt encrypted for the later reveal. */
async function commitDelegateVoteOnchain(
  proposalId: string,
  userId: string,
  agentId: string,
  pollAddress: string,
  choice: VoteChoice,
): Promise<void> {
  const { isGovernanceOnchainConfigured } = await import('@/lib/onchain/config')
  if (!isGovernanceOnchainConfigured()) return
  const { commitOnchainVote, CHOICE_TO_OPTION } = await import('@/lib/onchain/governance-poll')
  const option = CHOICE_TO_OPTION[choice]
  const result = await commitOnchainVote(agentId, pollAddress as `0x${string}`, option)
  if (!result) return
  const { encryptSecret } = await import('@/lib/crypto')
  await db
    .insert(govOnchainVote)
    .values({
      proposalId,
      userId,
      agentId,
      pollAddress,
      optionIndex: option,
      encryptedSalt: encryptSecret(result.salt),
      commitTxHash: result.txHash,
      status: 'committed',
    })
    .onConflictDoNothing()
    .catch(() => undefined)
}

/** Reveal every committed on-chain vote whose poll has entered its reveal
 *  window. Runs on the heartbeat; salts are discarded the moment a reveal
 *  lands. Gated + best-effort. Returns how many were revealed. */
export async function revealOnchainVotes(): Promise<{ pending: number; revealed: number }> {
  const { isGovernanceOnchainConfigured } = await import('@/lib/onchain/config')
  if (!isGovernanceOnchainConfigured()) return { pending: 0, revealed: 0 }
  // The table ships behind a migration that this deployment may not have run
  // yet, and an optional governance feature must never make the settlement
  // heartbeat report an error on every single pass — that trains everyone to
  // ignore the one field that would show a real outage.
  const committed = await db
    .select()
    .from(govOnchainVote)
    .where(eq(govOnchainVote.status, 'committed'))
    .catch(() => null)
  if (committed === null) return { pending: 0, revealed: 0 }
  if (committed.length === 0) return { pending: 0, revealed: 0 }
  const { pollPhase, revealOnchainVote } = await import('@/lib/onchain/governance-poll')
  const { decryptSecret } = await import('@/lib/crypto')
  let revealed = 0
  for (const v of committed) {
    if (!v.encryptedSalt) continue
    const phase = await pollPhase(v.pollAddress as `0x${string}`)
    if (phase !== 1) continue // 0=still committing, 2=ended (missed), null=off
    let salt: `0x${string}`
    try {
      salt = decryptSecret(v.encryptedSalt) as `0x${string}`
    } catch {
      continue
    }
    const txHash = await revealOnchainVote(v.agentId, v.pollAddress as `0x${string}`, v.optionIndex, salt)
    if (!txHash) continue
    await db
      .update(govOnchainVote)
      .set({ status: 'revealed', revealTxHash: txHash, encryptedSalt: null, updatedAt: new Date() })
      .where(and(eq(govOnchainVote.proposalId, v.proposalId), eq(govOnchainVote.userId, v.userId)))
      .catch(() => undefined)
    revealed++
  }
  return { pending: committed.length, revealed }
}

export interface DelegateReviewView {
  proposalId: string
  proposalTitle: string
  choice: VoteChoice
  confidence: number | null
  rationale: string | null
  reason: string | null
  closesAt: string
}

/** Pending delegate recommendations the owner still needs to decide on
 *  (open proposals only). */
export async function listPendingReviews(userId: string): Promise<DelegateReviewView[]> {
  const reviews = await db
    .select()
    .from(govDelegateReview)
    .where(and(eq(govDelegateReview.userId, userId), eq(govDelegateReview.status, 'pending')))
  if (reviews.length === 0) return []
  const now = new Date()
  const out: DelegateReviewView[] = []
  for (const r of reviews) {
    const [prop] = await db.select().from(govProposal).where(eq(govProposal.id, r.proposalId))
    if (!prop || prop.closesAt <= now) continue // closed → not actionable
    out.push({
      proposalId: r.proposalId,
      proposalTitle: prop.title,
      choice: r.choice as VoteChoice,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      rationale: r.rationale,
      reason: r.reason,
      closesAt: prop.closesAt.toISOString(),
    })
  }
  return out
}

/** The owner resolves an escalated recommendation: 'accept' casts the
 *  delegate's recommended choice (attributed to the delegate, marked as
 *  owner-confirmed), 'dismiss' just clears it. Owner-scoped by userId. */
export async function resolveDelegateReview(userId: string, proposalId: string, action: 'accept' | 'dismiss') {
  const [review] = await db
    .select()
    .from(govDelegateReview)
    .where(and(eq(govDelegateReview.proposalId, proposalId), eq(govDelegateReview.userId, userId)))
  if (!review || review.status !== 'pending') throw new Error('No pending review for this proposal')

  if (action === 'dismiss') {
    await db
      .update(govDelegateReview)
      .set({ status: 'dismissed' })
      .where(and(eq(govDelegateReview.proposalId, proposalId), eq(govDelegateReview.userId, userId)))
    return { ok: true as const, cast: false }
  }

  // accept → cast the recommended choice, then mark the review resolved.
  const r = await castVote(userId, proposalId, review.choice as VoteChoice, {
    viaAgentId: review.viaAgentId,
    rationale: review.rationale ? `(owner-confirmed) ${review.rationale}` : '(owner-confirmed)',
    confidence: review.confidence != null ? Number(review.confidence) : null,
  })
  await db
    .update(govDelegateReview)
    .set({ status: 'voted' })
    .where(and(eq(govDelegateReview.proposalId, proposalId), eq(govDelegateReview.userId, userId)))
  return { ok: true as const, cast: true, power: r.power }
}

export interface ProposalView {
  id: string
  title: string
  body: string
  createdAt: string
  closesAt: string
  open: boolean
  tally: Tally
  yourVote: VoteChoice | null
  /** If your vote was cast by an AI delegate, its rationale (else null). */
  yourVoteRationale: string | null
  /** How many of the votes on this proposal were cast by AI delegates. */
  delegateVotes: number
}

/** List recent proposals with live tallies + the caller's own vote.
 *  Finalizes status on any proposal whose voting window has closed. */
export async function listProposals(userId: string | null, limit = 25): Promise<ProposalView[]> {
  const props = await db.select().from(govProposal).orderBy(desc(govProposal.createdAt)).limit(limit)
  if (props.length === 0) return []
  const votes = await db.select().from(govVote)
  const byProposal = new Map<string, typeof votes>()
  for (const v of votes) {
    const list = byProposal.get(v.proposalId) ?? []
    list.push(v)
    byProposal.set(v.proposalId, list)
  }

  const out: ProposalView[] = []
  for (const p of props) {
    const pvotes = (byProposal.get(p.id) ?? []).map((v) => ({ choice: v.choice as VoteChoice, power: Number(v.power) }))
    const tally = tallyVotes(pvotes)
    const closed = p.closesAt <= new Date()
    // Finalize status once closed (best-effort, idempotent).
    if (closed && p.status === 'open') {
      const finalStatus = tally.passed ? 'passed' : 'rejected'
      await db.update(govProposal).set({ status: finalStatus }).where(eq(govProposal.id, p.id)).catch(() => {})
    }
    const yourRow = userId != null ? (byProposal.get(p.id) ?? []).find((v) => v.userId === userId) : undefined
    const delegateVotes = (byProposal.get(p.id) ?? []).filter((v) => v.viaAgentId != null).length
    out.push({
      id: p.id,
      title: p.title,
      body: p.body,
      createdAt: p.createdAt.toISOString(),
      closesAt: p.closesAt.toISOString(),
      open: !closed,
      tally,
      yourVote: (yourRow?.choice as VoteChoice | undefined) ?? null,
      yourVoteRationale: yourRow?.viaAgentId ? yourRow.rationale ?? null : null,
      delegateVotes,
    })
  }
  return out
}
