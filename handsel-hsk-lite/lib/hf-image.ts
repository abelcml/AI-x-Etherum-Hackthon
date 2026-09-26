import { getPlatformSecret } from '@/lib/platform-secret'
import { withRetry } from '@/lib/retry'

/**
 * Hugging Face Inference image generation (FLUX.1-schnell by default) — a
 * higher-quality, more reliable image backend than the keyless pollinations
 * fallback. Uses a shared HF token (platform_secrets 'hf_token', or the
 * HF_TOKEN env). Returns null when no token is configured or generation
 * fails, so callers can fall back to pollinations.
 */
// HF migrated FLUX off the classic hf-inference API; it's now served through
// Inference Providers. fal-ai serves FLUX.1-schnell and returns JSON with an
// image URL (not raw bytes), so we fetch that URL for the pixels.
const HF_ENDPOINT = process.env.HF_IMAGE_ENDPOINT || 'https://router.huggingface.co/fal-ai/fal-ai/flux/schnell'

function startsWith(b: Buffer, sig: number[]): boolean {
  if (b.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false
  return true
}

function isImageMagic(b: Buffer): boolean {
  return (
    b.length > 12 &&
    (startsWith(b, [0x89, 0x50, 0x4e, 0x47]) || // PNG
      startsWith(b, [0xff, 0xd8, 0xff]) || // JPEG
      (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'))
  )
}

export async function hfToken(): Promise<string | null> {
  return (await getPlatformSecret('hf_token')) || process.env.HF_TOKEN || null
}

export async function generateHfImage(prompt: string): Promise<{ mime: string; base64: string } | null> {
  const token = await hfToken()
  if (!token) return null

  try {
    // 1) Ask fal-ai (via the HF router) to generate — returns JSON w/ a URL.
    const res = await withRetry(
      async () => {
        const r = await fetch(HF_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.slice(0, 900), image_size: 'square_hd', num_images: 1 }),
          signal: AbortSignal.timeout(90_000),
        })
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HF image ${r.status}`), { status: r.status })
        return r
      },
      { retries: 3, baseMs: 2000 },
    )
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { images?: { url?: string; content_type?: string }[] } | null
    const img = data?.images?.[0]
    if (!img?.url) return null

    // 2) Fetch the actual pixels and validate.
    const imgRes = await fetch(img.url, { signal: AbortSignal.timeout(60_000) })
    if (!imgRes.ok) return null
    const mime = (img.content_type || imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0]
    const buf = Buffer.from(await imgRes.arrayBuffer())
    if (buf.length < 2000 || !isImageMagic(buf) || buf.length > 4 * 1024 * 1024) return null
    return { mime, base64: buf.toString('base64') }
  } catch {
    return null
  }
}
