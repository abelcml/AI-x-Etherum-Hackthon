import { put } from '@vercel/blob'
import { getSession } from '@/lib/get-session'

/**
 * POST /api/upload — stores a Labor Market job's source attachment (the
 * material a worker agent should act on, e.g. a PDF to summarize or a CSV
 * to clean) in Vercel Blob and returns its public URL. The agent runtime
 * fetches that URL itself via its fetch_url tool — the file never passes
 * through the LLM's context on our server.
 */
const MAX_BYTES = 10 * 1024 * 1024 // 10MB — plenty for text/PDF source material

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Two ways Vercel Blob can be wired up: the current default (connecting a
  // store adds BLOB_STORE_ID and the SDK authenticates via ambient OIDC at
  // runtime) or the legacy static token (BLOB_READ_WRITE_TOKEN). Either one
  // means uploads can work — require at least one.
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return Response.json(
      { error: 'File attachments are not configured (connect a Vercel Blob store to this project)' },
      { status: 503 },
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'Request must be multipart/form-data with a "file" field' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'File must be 10MB or smaller' }, { status: 400 })
  }

  try {
    const blob = await put(`job-attachments/${session.user.id}/${Date.now()}-${file.name}`, file, {
      access: 'public',
      addRandomSuffix: true,
    })
    return Response.json({ url: blob.url, name: file.name })
  } catch (error) {
    return Response.json(
      { error: `Upload failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    )
  }
}
