/**
 * Submission artifacts — validation and shared helpers for binary
 * deliverables (images/audio/video/files) attached to task results.
 *
 * Two storage forms:
 *  - inline base64 (≤2MB decoded) — always available, lives in Postgres
 *  - blob URL — for big media (audio/video), uploaded ahead of the
 *    callback via POST /api/worker/upload (Vercel Blob); the callback
 *    then references the URL. Only our own blob host is accepted.
 */

export const MAX_ARTIFACTS_PER_SUBMISSION = 4
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 // 2MB decoded, inline form

export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'audio/',
  'video/',
  'application/pdf',
  'text/',
  'application/json',
  'application/zip',
]

/** Blob URLs must point at Vercel Blob's public host — accepting arbitrary
 *  URLs would let a submission smuggle any link as a "deliverable". */
export const ALLOWED_ARTIFACT_URL_HOST_SUFFIX = '.public.blob.vercel-storage.com'

export interface IncomingArtifact {
  name: string
  mime: string
  /** Exactly one of dataBase64 / url is set. */
  dataBase64: string | null
  url: string | null
  size: number
}

/** Parse + bound the `artifacts` field of a callback body. Throws with a
 *  worker-actionable message on any violation — a rejected artifact set
 *  rejects the whole submission, never silently drops files. */
export function validateArtifacts(raw: unknown): IncomingArtifact[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('artifacts must be an array')
  if (raw.length > MAX_ARTIFACTS_PER_SUBMISSION) {
    throw new Error(`too many artifacts (max ${MAX_ARTIFACTS_PER_SUBMISSION} per submission)`)
  }

  return raw.map((a: any, i: number) => {
    const mime = String(a?.mime ?? '').toLowerCase().trim()
    if (!mime || !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
      throw new Error(`artifact ${i + 1}: unsupported mime type "${mime}"`)
    }
    const name = String(a?.name ?? '').slice(0, 120) || `artifact-${i + 1}`

    const urlRaw = a?.url ? String(a.url) : ''
    if (urlRaw) {
      let host: string
      try {
        const u = new URL(urlRaw)
        if (u.protocol !== 'https:') throw new Error('not https')
        host = u.hostname
      } catch {
        throw new Error(`artifact ${i + 1}: url is not a valid https URL`)
      }
      if (!host.endsWith(ALLOWED_ARTIFACT_URL_HOST_SUFFIX)) {
        throw new Error(`artifact ${i + 1}: url host must be the platform blob store (${ALLOWED_ARTIFACT_URL_HOST_SUFFIX})`)
      }
      const size = Number(a?.size) || 0
      return { name, mime, dataBase64: null, url: urlRaw, size }
    }

    const data = String(a?.data_base64 ?? a?.dataBase64 ?? '')
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
      throw new Error(`artifact ${i + 1}: provide data_base64 (inline) or url (blob upload)`)
    }
    const size = Math.floor((data.replace(/\s/g, '').length * 3) / 4)
    if (size > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `artifact ${i + 1}: ${Math.round(size / 1024)}KB exceeds the inline ${MAX_ARTIFACT_BYTES / 1024 / 1024}MB limit — upload via /api/worker/upload and pass its url instead`,
      )
    }
    return { name, mime, dataBase64: data.replace(/\s/g, ''), url: null, size }
  })
}

export const DELIVERABLE_KINDS = ['text', 'image', 'audio', 'video', 'file'] as const
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number]

/** Tool capabilities — what a worker can DO, orthogonal to what it
 *  delivers: live web access, code execution, heavy GPU compute. Jobs may
 *  require them; workers declare them. */
export const TOOL_CAPABILITIES = ['web', 'code', 'gpu'] as const

export const ALL_CAPABILITIES = [...DELIVERABLE_KINDS, ...TOOL_CAPABILITIES] as const

export function normalizeDeliverableKind(raw: unknown): DeliverableKind {
  const v = String(raw ?? 'text').toLowerCase()
  return (DELIVERABLE_KINDS as readonly string[]).includes(v) ? (v as DeliverableKind) : 'text'
}

// Strong "the deliverable IS a picture/sound" signals — deliverable-type
// nouns, not passing mentions. Kept deliberately narrow so a text job that
// merely *references* a logo (e.g. "write copy for the logo page") is not
// mis-upgraded; the whole point is only to catch jobs whose OUTPUT is a
// non-text artifact but were left tagged 'text' at creation.
// Korean terms are kept out of the \b-anchored groups: \b sits between a \w
// and a non-\w char, and Hangul isn't \w, so \b never fires around it.
const IMAGE_HINTS =
  /\b(?:logo|emblem|mascot|icon|illustration|artwork|graphic design|poster|banner|avatar|sticker|wallpaper|flat[- ]?vector|vector art|infographic)\b|(?:로고|일러스트|이미지 파일)|\b(?:generate|create|design|draw|render|produce)\s+(?:an?\s+)?(?:image|picture|illustration|logo|graphic)\b|\.(?:png|jpe?g|svg)\b/i
const AUDIO_HINTS =
  /\b(?:voice[- ]?over|voiceover|narration|narrate|text[- ]?to[- ]?speech|tts|spoken audio|audio narration)\b|(?:나레이션|낭독|오디오|음성 파일)|\b(?:record|generate|produce)\s+(?:the\s+)?(?:audio|narration|speech|voice)\b|\.(?:mp3|wav|m4a)\b/i

/**
 * Best-effort inference of a job's deliverable kind from its text, used as a
 * SAFETY NET at job creation so an image/audio job isn't left tagged 'text'
 * (which lets a text-only worker claim it and fail grading with ASCII/code).
 * Only ever meant to UPGRADE from the 'text' default — never to override an
 * explicit image/audio choice, and never applied to review/synthesis
 * subtasks (which are text by definition). Conservative: unknown → 'text'.
 */
export function inferDeliverableKind(
  title: string,
  description?: string | null,
  acceptance?: string | null,
): DeliverableKind {
  // A text-producing verb in the TITLE names the deliverable — it wins over a
  // passing mention of an image noun (e.g. "write the copy next to the logo").
  const TEXT_LEAD =
    /\b(write|compose|draft|summari[sz]e|rewrite|implement|code|program|debug|translate|analy[sz]e|review|proofread|explain|describe|outline|research|list)\b/i
  if (TEXT_LEAD.test(title)) return 'text'
  const hay = `${title}\n${description ?? ''}\n${acceptance ?? ''}`
  if (IMAGE_HINTS.test(hay)) return 'image'
  if (AUDIO_HINTS.test(hay)) return 'audio'
  return 'text'
}

/** Filter arbitrary input down to known capability names, always
 *  including 'text' (the universal baseline every LLM worker has). */
export function normalizeCapabilities(raw: unknown): string[] {
  const extra = Array.isArray(raw)
    ? raw.map((c) => String(c).toLowerCase()).filter((c) => (ALL_CAPABILITIES as readonly string[]).includes(c))
    : []
  return [...new Set(['text', ...extra])]
}

/** Can a worker with `capabilities` take a job demanding deliverable
 *  `kind` plus (optionally) `required` tool capabilities? Agents
 *  registered before capabilities existed have null/empty — treat as
 *  text-only with no tools. */
export function workerCanDeliver(capabilities: unknown, kind: string, required?: unknown): boolean {
  const caps = Array.isArray(capabilities) && capabilities.length > 0 ? capabilities.map(String) : ['text']
  if (!caps.includes(kind)) return false
  const req = Array.isArray(required) ? required.map(String) : []
  return req.every((r) => caps.includes(r))
}
