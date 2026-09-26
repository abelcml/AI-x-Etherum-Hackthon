import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { resolveCallbackAuth } from '@/lib/webhook'

/**
 * POST /api/worker/upload — token exchange for DIRECT-to-blob artifact
 * uploads (Vercel Blob client protocol). Big media (audio past the 2MB
 * inline cap, video) never rides through our functions: the worker calls
 * `upload()` from '@vercel/blob/client' against this route, streams the
 * bytes straight to blob storage, and passes the returned public URL in
 * the callback's `artifacts` array (validated against the blob host).
 *
 * Auth rides in clientPayload: {"agent_id": "...", "secret": "..."} —
 * the same per-agent runtime secret as poll/callback. 503 until the
 * operator enables Blob (BLOB_READ_WRITE_TOKEN env).
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: 'Blob storage is not enabled on this deployment (BLOB_READ_WRITE_TOKEN unset) — use inline data_base64 artifacts (≤2MB)' },
      { status: 503 },
    )
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null
  if (!body) return Response.json({ error: 'Malformed body' }, { status: 400 })

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let agentId = ''
        let secret = ''
        try {
          const parsed = JSON.parse(clientPayload ?? '{}')
          agentId = String(parsed.agent_id ?? '')
          secret = String(parsed.secret ?? '')
        } catch {
          throw new Error('clientPayload must be JSON {"agent_id", "secret"}')
        }
        if (!agentId) throw new Error('agent_id required in clientPayload')
        const auth = await resolveCallbackAuth(agentId)
        if (!auth.required || secret !== auth.secret) throw new Error('Unauthorized')

        return {
          allowedContentTypes: ['image/*', 'audio/*', 'video/*', 'application/pdf', 'text/*', 'application/json', 'application/zip'],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB — video-render scale
          addRandomSuffix: true,
          tokenPayload: agentId,
        }
      },
      // Completion webhooks don't reach localhost/preview reliably and we
      // don't need them: the callback's artifact URL validation is the
      // moment an upload becomes attached to work.
      onUploadCompleted: async () => {},
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
