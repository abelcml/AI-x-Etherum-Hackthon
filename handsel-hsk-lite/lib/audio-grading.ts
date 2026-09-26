/**
 * Audio grading — the speech analogue of vision-grading.ts. The worker's
 * audio lane produces a spoken rendering of a target script (TTS); the
 * grader transcribes the submitted audio with an independent STT model
 * (Whisper via an OpenAI-compatible endpoint, e.g. Groq) and checks the
 * transcript against the job's target script. Grader ≠ solver: the worker
 * never grades its own audio.
 *
 * Verdict semantics mirror the other graders: `passed: true|false` is a
 * usable verdict that drives auto-settlement; `passed: null` means grading
 * was UNAVAILABLE (no transcription key configured, provider error) — an
 * infra fact, not evidence about the work — and the job falls back to
 * manual review.
 */
import { resolveUserOpenAiKey } from '@/lib/user-keys'

const ALLOWED_AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'])
const TRANSCRIBE_MODEL = 'whisper-large-v3-turbo'
/** Round-trip TTS→STT is imperfect (homophones, dropped articles); a clear
 *  short sentence still lands well above this. Below it, the audio does not
 *  match the requested script. */
const PASS_RATIO = 0.6

export interface GradedVerdict {
  passed: boolean | null
  output: string
  gradedAt: string
}

/** Lowercase, strip punctuation, collapse whitespace → word list. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Fraction of the target's words present in the transcript (multiset
 *  overlap — order-independent, tolerant of a few STT slips). */
function overlapRatio(target: string, transcript: string): number {
  const want = words(target)
  if (want.length === 0) return 0
  const have = new Map<string, number>()
  for (const w of words(transcript)) have.set(w, (have.get(w) ?? 0) + 1)
  let matched = 0
  for (const w of want) {
    const n = have.get(w) ?? 0
    if (n > 0) {
      matched++
      have.set(w, n - 1)
    }
  }
  return matched / want.length
}

export async function gradeAudioSubmission(
  spec: { title: string; description: string | null; acceptanceCriteria: string | null },
  artifacts: { mime: string; dataBase64: string | null; url?: string | null }[],
  requesterOwnerUserId: string | null,
): Promise<GradedVerdict> {
  const gradedAt = new Date().toISOString()

  // The target script IS the acceptance criteria for house audio jobs (the
  // exact sentence to speak). No script → nothing to grade against.
  const target = (spec.acceptanceCriteria ?? '').trim()
  if (!target) {
    return { passed: null, output: 'No target script on this audio job — routed to manual review.', gradedAt }
  }

  // Resolve the audio bytes of the first readable audio artifact.
  let audio: { mime: string; bytes: Buffer } | null = null
  for (const a of artifacts) {
    if (!ALLOWED_AUDIO_MIMES.has(a.mime)) continue
    if (a.dataBase64) {
      audio = { mime: a.mime, bytes: Buffer.from(a.dataBase64, 'base64') }
      break
    }
    if (a.url) {
      try {
        const res = await fetch(a.url, { signal: AbortSignal.timeout(20_000) })
        const buf = Buffer.from(await res.arrayBuffer())
        if (res.ok && buf.length <= 10 * 1024 * 1024) {
          audio = { mime: a.mime, bytes: buf }
          break
        }
      } catch { /* unreachable blob — treat as absent */ }
    }
  }
  if (!audio) {
    // Definite failure: the job demanded audio and none is attached.
    return { passed: false, output: 'No audio artifact attached — this job requires an audio deliverable.', gradedAt }
  }

  // Transcription runs on an OpenAI-compatible STT endpoint (Groq Whisper).
  const creds = requesterOwnerUserId ? await resolveUserOpenAiKey(requesterOwnerUserId).catch(() => null) : null
  if (!creds?.apiKey || !creds.baseUrl) {
    return {
      passed: null,
      output: 'Audio grading unavailable (no transcription key on the requester account) — awaiting manual review.',
      gradedAt,
    }
  }

  try {
    const form = new FormData()
    const ext = audio.mime.includes('wav') ? 'wav' : audio.mime.includes('ogg') ? 'ogg' : audio.mime.includes('webm') ? 'webm' : 'mp3'
    form.append('file', new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), `submission.${ext}`)
    form.append('model', TRANSCRIBE_MODEL)
    form.append('response_format', 'json')

    const { withRetry } = await import('@/lib/retry')
    // Retry transient provider errors (429/5xx) so a momentary overload
    // doesn't leave the job ungraded in Submitted.
    const res = await withRetry(async () => {
      const r = await fetch(`${creds.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${creds.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      })
      if (r.status === 429 || r.status >= 500) {
        throw Object.assign(new Error(`transcription provider ${r.status}`), { status: r.status })
      }
      return r
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        passed: null,
        output: `Transcription provider error ${res.status}: ${body.slice(0, 160)} — awaiting manual review.`,
        gradedAt,
      }
    }
    const data = (await res.json()) as { text?: string }
    const transcript = (data.text ?? '').trim()
    const ratio = overlapRatio(target, transcript)
    const passed = ratio >= PASS_RATIO
    return {
      passed,
      output: passed
        ? `Transcript matches the script (${Math.round(ratio * 100)}% of words). Heard: "${transcript.slice(0, 160)}"`
        : `Transcript does not match the target script (${Math.round(ratio * 100)}% < ${Math.round(PASS_RATIO * 100)}%). Target: "${target.slice(0, 120)}" — heard: "${transcript.slice(0, 160)}"`,
      gradedAt,
    }
  } catch (error) {
    return {
      passed: null,
      output: `Audio grading errored (${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}) — awaiting manual review.`,
      gradedAt,
    }
  }
}
