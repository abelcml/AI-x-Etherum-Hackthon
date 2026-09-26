import { runDemo, type DemoKind } from '@/lib/demo-run'

/**
 * Public, no-auth demo runner — the front door funnel. Generates + grades a
 * task through the real engine (no wallet/escrow). Abuse-bounded by a
 * best-effort per-IP limiter, a prompt-length cap, and a global per-instance
 * cap; the graders themselves cost real tokens, so keep the caps tight.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const WINDOW_MS = 60 * 60 * 1000
const PER_IP_PER_HOUR = 8
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (arr.length >= PER_IP_PER_HOUR) {
    hits.set(ip, arr)
    return true
  }
  arr.push(now)
  hits.set(ip, arr)
  return false
}

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) {
    return Response.json({ error: 'Rate limit reached — try again later.' }, { status: 429 })
  }

  let kind: DemoKind, prompt: string
  try {
    const body = await request.json()
    kind = body?.kind
    prompt = String(body?.prompt ?? '').trim()
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!['text', 'image', 'audio'].includes(kind)) {
    return Response.json({ error: 'kind must be text, image, or audio' }, { status: 400 })
  }
  if (prompt.length < 3) return Response.json({ error: 'prompt too short' }, { status: 400 })
  if (prompt.length > 500) return Response.json({ error: 'prompt too long (max 500 chars)' }, { status: 400 })

  try {
    const result = await runDemo(kind, prompt)
    return Response.json({ status: 'ok', ...result })
  } catch (error) {
    console.error('[demo/run] failed:', error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
