import { db } from '@/lib/db'
import { user, oauthToken } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { authThrottled, throttleIp } from '@/lib/auth-throttle'

const TOKEN_TTL_DAYS = 90

/**
 * POST /api/oauth/personal-token — mint a personal MCP bearer token with
 * email+password, for MCP clients that can't run the browser OAuth flow:
 * Gemini CLI builds without remote-OAuth support, Google ADK MCPToolset
 * (header-based auth), plain scripts. Claude/ChatGPT should keep using
 * the real OAuth flow (/oauth/authorize) — this is the headless fallback,
 * same credential check as sign-in, same 90-day opaque token the token
 * endpoint issues, revocable by deleting the oauth_tokens row.
 *
 * Body: { email, password, label? }
 */
export async function POST(request: Request) {
  // Unauthenticated credential check — durable per-IP throttle (survives
  // serverless fan-out) so it can't be a password-stuffing oracle.
  if (await authThrottled('personal-token', throttleIp(request))) {
    return Response.json({ error: 'Too many attempts — try again later' }, { status: 429 })
  }

  const body = await request.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')
  if (!email || !password) {
    return Response.json({ error: 'email and password are required' }, { status: 400 })
  }

  const [u] = await db.select({ id: user.id, password: user.password }).from(user).where(eq(user.email, email))
  if (!u?.password || !(await bcrypt.compare(password, u.password))) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = `lmk_${nanoid(40)}`
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000)
  await db.insert(oauthToken).values({
    token,
    userId: u.id,
    clientId: `personal:${String(body?.label ?? 'cli').slice(0, 40)}`,
    scope: 'mcp',
    expiresAt,
  })

  return Response.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_DAYS * 24 * 3600,
    usage: 'Send as "Authorization: Bearer <token>" to POST /api/mcp',
  })
}
