/**
 * GET /api/github/oauth/start?next=/jobs
 *
 * Begins GitHub sign-in (no session) or account linking (session present).
 * Both are the same redirect: GitHub decides whether to show a consent
 * screen, so an already-authorized user bounces straight back.
 */
import { cookies } from 'next/headers'
import { GITHUB_STATE_COOKIE, authorizeUrl, githubOauthConfig, mintState, safeNextPath } from '@/lib/github-oauth'

export async function GET(request: Request) {
  const config = await githubOauthConfig()
  if (!config) {
    return Response.json({ error: 'GitHub sign-in is not configured on this deployment.' }, { status: 503 })
  }

  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next'))
  const state = mintState(next, config.clientSecret)

  const jar = await cookies()
  jar.set(GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive the cross-site redirect back from github.com
    maxAge: 10 * 60,
    path: '/',
  })

  return Response.redirect(
    authorizeUrl({
      clientId: config.clientId,
      redirectUri: `${url.origin}/api/github/oauth/callback`,
      state,
    }),
    302,
  )
}
