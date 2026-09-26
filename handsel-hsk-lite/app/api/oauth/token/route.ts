import { db } from '@/lib/db'
import { oauthClient, oauthCode, oauthToken } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

const TOKEN_TTL_DAYS = 90

/**
 * Token endpoint: authorization_code + PKCE S256 only. Public clients
 * (no secret) — the verifier IS the proof of possession. Codes are
 * single-use and 10-minute-expiring (enforced at creation).
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  if (!form) return tokenError('invalid_request', 'expected form-encoded body')

  if (form.get('grant_type') !== 'authorization_code') {
    return tokenError('unsupported_grant_type', 'only authorization_code is supported')
  }
  const code = String(form.get('code') ?? '')
  const verifier = String(form.get('code_verifier') ?? '')
  const clientId = String(form.get('client_id') ?? '')
  const redirectUri = String(form.get('redirect_uri') ?? '')
  if (!code || !verifier || !clientId) return tokenError('invalid_request', 'code, code_verifier, client_id required')

  const [row] = await db.select().from(oauthCode).where(eq(oauthCode.code, code))
  // Single-use: burn the code immediately, valid or not.
  if (row) await db.delete(oauthCode).where(eq(oauthCode.code, code))

  if (!row || row.expiresAt < new Date()) return tokenError('invalid_grant', 'code expired or unknown')
  if (row.clientId !== clientId) return tokenError('invalid_grant', 'client mismatch')
  if (redirectUri && row.redirectUri !== redirectUri) return tokenError('invalid_grant', 'redirect_uri mismatch')

  // PKCE S256: base64url(sha256(verifier)) must equal the stored challenge.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const computed = Buffer.from(digest).toString('base64url')
  if (computed !== row.codeChallenge) return tokenError('invalid_grant', 'PKCE verification failed')

  const [client] = await db.select().from(oauthClient).where(eq(oauthClient.id, clientId))
  if (!client) return tokenError('invalid_client', 'unknown client')

  const token = `lmk_${nanoid(40)}`
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000)
  await db.insert(oauthToken).values({ token, userId: row.userId, clientId, scope: row.scope, expiresAt })

  return Response.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_DAYS * 24 * 3600,
    scope: row.scope,
  })
}

function tokenError(error: string, description: string) {
  return Response.json({ error, error_description: description }, { status: 400 })
}
