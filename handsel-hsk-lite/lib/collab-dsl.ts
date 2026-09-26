/**
 * Collab DSL — a small, human- and agent-readable serialization of a
 * delegation's collaboration graph. JSON stays the canonical wire format
 * (what the planner emits, what we store); this DSL is a layer ON TOP of it:
 *
 *   plan "Eco tumbler brand kit" budget $24
 *
 *   logo = image $10 "Design the logo"
 *     do Produce a minimalist flat-vector logo, earthy palette.
 *     ok A single image, no text, earthy tones.
 *
 *   voice = audio $10 "Record the intro" needs logo, slogan
 *     do Record a 15s spoken brand intro.
 *     ok Clear speech matching the script.
 *
 *   check "Everything assembles"
 *     ok The three parts form one coherent kit.
 *
 * Two uses: render a delegation as a readable PROGRAM (page + proofs), and
 * hand each worker a compact map of the whole collaboration and where it sits
 * (situational context) — so agents coordinate, not just do isolated pieces.
 *
 * Pure and dependency-free so it unit-tests cleanly and runs anywhere. Round
 * trips the structural fields (title / kind / bounty / dependsOn) and the
 * single-line brief (do/ok); testCode and runtime state live in JSON, not here.
 */
import type { DelegationSubtask } from '@/lib/delegation'

export interface CollabPlan {
  task: string
  budgetUsd: number
  subtasks: DelegationSubtask[]
}

const KINDS = new Set(['text', 'image', 'audio'])

/** Stable, readable id from a title (slug), deduped within a plan. */
function slugId(title: string, used: Set<string>): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'task'
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Neutralize a value being interpolated into a DSL *structure* line.
 *
 * This used to only swap double quotes for single ones, which reads like
 * escaping but leaves the line-oriented half of the grammar wide open: the
 * DSL is newline-delimited, so a title containing a newline forges an extra
 * line. That block is pasted into every worker's brief as "here is the plan
 * and where your piece fits", so a forged line invents dependencies,
 * subtasks or instructions that the worker reads as the coordinator's own
 * words — DSL injection, the structural cousin of prompt injection.
 *
 * Collapsing whitespace closes it: a value can no longer span lines, and
 * with quotes already folded there is nothing left to terminate the token
 * early. Titles are single-line by nature, so nothing legitimate is lost.
 */
const safe = (s: string): string => oneLine(s).replace(/"/g, "'")

/** Serialize a plan to the DSL. `compact` drops the do/ok brief lines,
 *  leaving just the structural map — used for the per-worker context block. */
export function graphToDsl(plan: CollabPlan, opts: { compact?: boolean } = {}): string {
  const { task, budgetUsd, subtasks } = plan
  const idByTitle = new Map<string, string>()
  const used = new Set<string>()
  for (const st of subtasks) {
    if (st.isIntegration) continue
    idByTitle.set(st.title, slugId(st.title, used))
  }

  const out: string[] = [`plan "${safe(task)}" budget $${budgetUsd}`, '']
  for (const st of subtasks) {
    if (st.isIntegration) {
      out.push(`check "${safe(st.title)}"`)
      if (!opts.compact && st.acceptanceCriteria) out.push(`  ok ${oneLine(st.acceptanceCriteria)}`)
      out.push('')
      continue
    }
    if (st.reviewOf) {
      const rid = idByTitle.get(st.title)!
      const targetId = idByTitle.get(st.reviewOf) ?? slugId(st.reviewOf, used)
      out.push(`${rid} = review $${st.bountyUsd} "${safe(st.title)}" of ${targetId}`)
      if (!opts.compact && st.acceptanceCriteria) out.push(`  ok ${oneLine(st.acceptanceCriteria)}`)
      out.push('')
      continue
    }
    if (st.synthesizes?.length) {
      const sid = idByTitle.get(st.title)!
      const pieceIds = st.synthesizes.map((t) => idByTitle.get(t) ?? slugId(t, used))
      out.push(`${sid} = assemble $${st.bountyUsd} "${safe(st.title)}" of ${pieceIds.join(', ')}`)
      if (!opts.compact && st.acceptanceCriteria) out.push(`  ok ${oneLine(st.acceptanceCriteria)}`)
      out.push('')
      continue
    }
    const id = idByTitle.get(st.title)!
    const kind = st.deliverableKind ?? 'text'
    const needs = (st.dependsOn ?? []).map((t) => idByTitle.get(t)).filter(Boolean)
    const needsStr = needs.length ? ` needs ${needs.join(', ')}` : ''
    out.push(`${id} = ${kind} $${st.bountyUsd} "${safe(st.title)}"${needsStr}`)
    if (!opts.compact) {
      if (st.description) out.push(`  do ${oneLine(st.description)}`)
      if (st.acceptanceCriteria) out.push(`  ok ${oneLine(st.acceptanceCriteria)}`)
    }
    out.push('')
  }
  return out.join('\n').trim() + '\n'
}

/** Parse DSL back into a plan. Inverse of graphToDsl for the fields the DSL
 *  carries (testCode is not represented and comes back null). Lenient: blank
 *  lines and unknown indented keys are ignored. */
export function dslToGraph(dsl: string): CollabPlan {
  let task = ''
  let budgetUsd = 0
  type Raw = {
    id?: string
    title: string
    kind: 'text' | 'image' | 'audio'
    bounty: number
    needs: string[]
    doText?: string
    ok?: string
    isIntegration?: boolean
    reviewOfId?: string
    synthesizesIds?: string[]
  }
  const raws: Raw[] = []
  let cur: Raw | null = null

  for (const line of dsl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const planM = trimmed.match(/^plan\s+"([^"]*)"\s+budget\s+\$?([\d.]+)/i)
    if (planM) {
      task = planM[1]
      budgetUsd = Number(planM[2])
      continue
    }
    const checkM = trimmed.match(/^check\s+"([^"]*)"/i)
    if (checkM) {
      cur = { title: checkM[1], kind: 'text', bounty: 0, needs: [], isIntegration: true }
      raws.push(cur)
      continue
    }
    const revM = trimmed.match(/^([a-z0-9-]+)\s*=\s*review\s+\$?([\d.]+)\s+"([^"]*)"\s+of\s+([a-z0-9-]+)$/i)
    if (revM) {
      cur = { id: revM[1], kind: 'text', bounty: Number(revM[2]), title: revM[3], needs: [], reviewOfId: revM[4] }
      raws.push(cur)
      continue
    }
    const asmM = trimmed.match(/^([a-z0-9-]+)\s*=\s*assemble\s+\$?([\d.]+)\s+"([^"]*)"\s+of\s+(.+)$/i)
    if (asmM) {
      cur = {
        id: asmM[1],
        kind: 'text',
        bounty: Number(asmM[2]),
        title: asmM[3],
        needs: [],
        synthesizesIds: asmM[4].split(',').map((s) => s.trim()).filter(Boolean),
      }
      raws.push(cur)
      continue
    }
    const headM = trimmed.match(/^([a-z0-9-]+)\s*=\s*(text|image|audio)\s+\$?([\d.]+)\s+"([^"]*)"(?:\s+needs\s+(.+))?$/i)
    if (headM && KINDS.has(headM[2].toLowerCase())) {
      cur = {
        id: headM[1],
        kind: headM[2].toLowerCase() as Raw['kind'],
        bounty: Number(headM[3]),
        title: headM[4],
        needs: headM[5] ? headM[5].split(',').map((s) => s.trim()).filter(Boolean) : [],
      }
      raws.push(cur)
      continue
    }
    if (cur) {
      const doM = trimmed.match(/^do\s+(.+)$/i)
      if (doM) {
        cur.doText = doM[1]
        continue
      }
      const okM = trimmed.match(/^ok\s+(.+)$/i)
      if (okM) {
        cur.ok = okM[1]
        continue
      }
    }
  }

  const titleById = new Map(raws.filter((r) => r.id).map((r) => [r.id as string, r.title]))
  const subtasks: DelegationSubtask[] = raws.map((r) => {
    if (r.isIntegration) {
      return {
        title: r.title,
        description: '',
        acceptanceCriteria: r.ok ?? 'Integration tests pass against the assembled result.',
        bountyUsd: 0,
        deliverableKind: 'text' as const,
        testCode: null,
        isIntegration: true,
      }
    }
    const reviewOf = r.reviewOfId ? titleById.get(r.reviewOfId) : undefined
    const synthesizes = r.synthesizesIds
      ?.map((id) => titleById.get(id))
      .filter((t): t is string => Boolean(t))
    const dependsOn = r.needs
      .map((id) => titleById.get(id))
      .filter((t): t is string => Boolean(t))
    // A review depends on the work it reviews; a synthesis on every piece.
    if (reviewOf && !dependsOn.includes(reviewOf)) dependsOn.unshift(reviewOf)
    for (const piece of synthesizes ?? []) if (!dependsOn.includes(piece)) dependsOn.push(piece)
    return {
      title: r.title,
      description: r.doText ?? '',
      acceptanceCriteria: r.ok ?? '',
      bountyUsd: r.bounty,
      deliverableKind: r.kind,
      testCode: null,
      ...(reviewOf ? { reviewOf } : {}),
      ...(synthesizes && synthesizes.length ? { synthesizes } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
    }
  })

  return { task, budgetUsd, subtasks }
}
