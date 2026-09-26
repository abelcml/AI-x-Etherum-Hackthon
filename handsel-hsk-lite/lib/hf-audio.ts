import { hfToken } from '@/lib/hf-image'
import { withRetry } from '@/lib/retry'

/**
 * Hugging Face text-to-speech (Kokoro-82M via the fal-ai provider route) — a
 * higher-quality, more natural voice than the keyless Google-Translate TTS
 * fallback. Uses the same shared HF token as image generation
 * (platform_secrets 'hf_token', or the HF_TOKEN env).
 *
 * Like the image path, this returns null on ANY failure — no token, out of
 * HF Inference-Provider credits (402), provider error, unusable audio — so the
 * caller transparently falls back to Google TTS. The two backends are
 * interchangeable from the grader's point of view: grading transcribes the
 * audio with Whisper regardless of which engine produced it.
 *
 * The fal-ai route returns JSON with an audio URL (not raw bytes), so we fetch
 * that URL for the actual audio.
 */
const HF_AUDIO_ENDPOINT =
  process.env.HF_AUDIO_ENDPOINT || 'https://router.huggingface.co/fal-ai/fal-ai/kokoro/american-english'
const HF_AUDIO_VOICE = process.env.HF_AUDIO_VOICE || 'af_heart'

const AUDIO_MAGIC: Record<string, number[]> = {
  'audio/mpeg': [0x49, 0x44, 0x33], // ID3 (MP3)
  wav: [0x52, 0x49, 0x46, 0x46], // RIFF
  ogg: [0x4f, 0x67, 0x67, 0x53], // OggS
}

function startsWith(b: Buffer, sig: number[]): boolean {
  if (b.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false
  return true
}

/** Cheap sniff that the bytes are a recognizable audio container (or a bare
 *  MP3 frame, which starts with 0xFF 0xEz). Guards against submitting an
 *  error page or truncated blob as "audio". */
function looksLikeAudio(b: Buffer): boolean {
  if (b.length < 1024) return false
  if (startsWith(b, AUDIO_MAGIC['audio/mpeg']) || startsWith(b, AUDIO_MAGIC.wav) || startsWith(b, AUDIO_MAGIC.ogg)) return true
  // Bare MPEG audio frame sync: 0xFF followed by 0xE0-0xFF.
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0
}

function mimeFromBytes(b: Buffer, headerMime: string | null): string {
  if (startsWith(b, AUDIO_MAGIC.wav)) return 'audio/wav'
  if (startsWith(b, AUDIO_MAGIC.ogg)) return 'audio/ogg'
  if (startsWith(b, AUDIO_MAGIC['audio/mpeg']) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  const m = (headerMime || '').split(';')[0].trim()
  return m.startsWith('audio/') ? m : 'audio/mpeg'
}

export async function generateHfAudio(script: string): Promise<{ mime: string; base64: string } | null> {
  const token = await hfToken()
  if (!token) return null
  const text = script.replace(/\s+/g, ' ').trim().slice(0, 900)
  if (!text) return null

  try {
    // 1) Ask fal-ai (via the HF router) to synthesize — returns JSON w/ a URL.
    const res = await withRetry(
      async () => {
        const r = await fetch(HF_AUDIO_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text, voice: HF_AUDIO_VOICE }),
          signal: AbortSignal.timeout(90_000),
        })
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HF audio ${r.status}`), { status: r.status })
        return r
      },
      { retries: 3, baseMs: 2000 },
    )
    if (!res.ok) return null // 402 (no credits), 4xx → fall back to Google TTS
    const data = (await res.json().catch(() => null)) as
      | { audio?: { url?: string; content_type?: string }; audio_url?: string; output?: { url?: string } }
      | null
    const audioUrl = data?.audio?.url || data?.audio_url || data?.output?.url
    if (!audioUrl) return null

    // 2) Fetch the actual audio bytes and validate.
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) })
    if (!audioRes.ok) return null
    const buf = Buffer.from(await audioRes.arrayBuffer())
    if (!looksLikeAudio(buf) || buf.length > 10 * 1024 * 1024) return null
    const mime = mimeFromBytes(buf, data?.audio?.content_type || audioRes.headers.get('content-type'))
    return { mime, base64: buf.toString('base64') }
  } catch {
    return null
  }
}
