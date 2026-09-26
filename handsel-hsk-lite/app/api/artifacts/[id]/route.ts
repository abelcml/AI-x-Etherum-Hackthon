import { db } from '@/lib/db'
import { artifact } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * GET /api/artifacts/:id — serve a submission artifact as raw bytes. The
 * unguessable nanoid id is the access token, matching the attachment-URL
 * model used elsewhere. Immutable: artifacts never change, so cache hard.
 *
 * SECURITY: artifacts are worker-supplied content served from OUR origin,
 * where the dashboard's session cookie lives. An `inline` text/html or
 * image/svg+xml would be stored XSS. Defenses, defense-in-depth:
 *  - only genuinely renderable media (image raster / audio / video / pdf)
 *    is served `inline`; everything else is forced to `attachment` so the
 *    browser downloads instead of executing it;
 *  - `X-Content-Type-Options: nosniff` stops the browser re-interpreting a
 *    mislabeled payload as HTML;
 *  - a strict `Content-Security-Policy: sandbox` neuters any script/plugin
 *    even if a payload does get rendered (covers SVG, which can carry
 *    script yet has image/* mime).
 */

// Raster image types are safe to render inline; SVG is deliberately NOT
// here (image/* mime but a scriptable XML document).
const INLINE_SAFE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'application/pdf',
])

function inlineable(mime: string): boolean {
  const m = mime.toLowerCase()
  return INLINE_SAFE.has(m) || m.startsWith('audio/') || m.startsWith('video/')
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [row] = await db.select().from(artifact).where(eq(artifact.id, id))
  if (!row) return new Response('Not found', { status: 404 })

  const safeName = row.name.replace(/[^\w.-]/g, '_') || 'artifact'
  const disposition = inlineable(row.mime) ? 'inline' : 'attachment'
  const securityHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'",
    'Content-Disposition': `${disposition}; filename="${safeName}"`,
    'Cache-Control': 'public, max-age=31536000, immutable',
  }

  // Blob-stored artifacts redirect to their public URL — the bytes never
  // pass through a function. The blob host serves them from a DIFFERENT
  // origin (no dashboard cookie there), so cross-origin isolation already
  // contains them; still pin nosniff + disposition on the redirect.
  if (row.url) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: row.url,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${disposition}; filename="${safeName}"`,
      },
    })
  }
  if (!row.dataBase64) return new Response('Artifact has no content', { status: 410 })

  const bytes = Buffer.from(row.dataBase64, 'base64')
  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(bytes.length),
      ...securityHeaders,
    },
  })
}
