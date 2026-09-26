/**
 * A platform user's GitHub identity — the link that turns "type owner/name
 * and hope our App is installed" into "pick from your repositories".
 *
 * The user access token is stored ENCRYPTED in our own table rather than
 * inside better-auth's account model: this app's live sign-in path is the
 * hand-rolled one in /api/signin (bcrypt + `session` table + `auth_session`
 * cookie), so better-auth's social machinery would produce a session that
 * getSession() cannot read. Owning the table keeps the two independent.
 *
 * The token is user-to-server: it can only see what the user can see, and
 * only through the App's permissions. It is never handed to a worker, never
 * returned to the client, and never logged.
 */
import { pool } from '@/lib/db'
import { encryptSecret, decryptSecret } from '@/lib/crypto'

export type GithubIdentity = {
  userId: string
  githubUserId: string
  login: string
  avatarUrl: string | null
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

async function ensureTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS github_identities (
       user_id           text PRIMARY KEY,
       github_user_id    text NOT NULL,
       login             text NOT NULL,
       avatar_url        text,
       access_token_enc  text NOT NULL,
       refresh_token_enc text,
       expires_at        timestamptz,
       updated_at        timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS github_identities_github_user_id_idx ON github_identities (github_user_id)',
  )
}

export async function saveGithubIdentity(input: {
  userId: string
  githubUserId: string
  login: string
  avatarUrl?: string | null
  accessToken: string
  refreshToken?: string | null
  expiresAt?: Date | null
}): Promise<void> {
  await ensureTable()
  await pool.query(
    `INSERT INTO github_identities
       (user_id, github_user_id, login, avatar_url, access_token_enc, refresh_token_enc, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id) DO UPDATE SET
       github_user_id = $2, login = $3, avatar_url = $4,
       access_token_enc = $5, refresh_token_enc = $6, expires_at = $7, updated_at = now()`,
    [
      input.userId,
      input.githubUserId,
      input.login,
      input.avatarUrl ?? null,
      encryptSecret(input.accessToken),
      input.refreshToken ? encryptSecret(input.refreshToken) : null,
      input.expiresAt ?? null,
    ],
  )
}

type Row = {
  user_id: string
  github_user_id: string
  login: string
  avatar_url: string | null
  access_token_enc: string
  refresh_token_enc: string | null
  expires_at: Date | null
}

function hydrate(row: Row): GithubIdentity {
  return {
    userId: row.user_id,
    githubUserId: row.github_user_id,
    login: row.login,
    avatarUrl: row.avatar_url,
    accessToken: decryptSecret(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc) : null,
    expiresAt: row.expires_at,
  }
}

export async function getGithubIdentity(userId: string): Promise<GithubIdentity | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<Row>('SELECT * FROM github_identities WHERE user_id = $1', [userId])
    return rows[0] ? hydrate(rows[0]) : null
  } catch {
    return null
  }
}

/** Which platform user (if any) this GitHub account already belongs to. */
export async function userIdForGithubUser(githubUserId: string): Promise<string | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM github_identities WHERE github_user_id = $1',
      [githubUserId],
    )
    return rows[0]?.user_id ?? null
  } catch {
    return null
  }
}

export async function disconnectGithub(userId: string): Promise<void> {
  await ensureTable()
  await pool.query('DELETE FROM github_identities WHERE user_id = $1', [userId])
}

/** True when the stored token is expired (or about to be), given the clock. */
export function tokenNeedsRefresh(expiresAt: Date | null, now = new Date(), skewMs = 60_000): boolean {
  if (!expiresAt) return false // non-expiring token (App without token expiration enabled)
  return expiresAt.getTime() - skewMs <= now.getTime()
}

/**
 * A usable user access token, refreshing it first when the App has token
 * expiration turned on. Returns null when the user hasn't connected GitHub
 * or the refresh failed (they need to reconnect).
 */
export async function githubUserToken(userId: string): Promise<string | null> {
  const identity = await getGithubIdentity(userId)
  if (!identity) return null
  if (!tokenNeedsRefresh(identity.expiresAt)) return identity.accessToken
  if (!identity.refreshToken) return null

  const { githubOauthConfig } = await import('@/lib/github-oauth')
  const config = await githubOauthConfig()
  if (!config) return null

  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: identity.refreshToken,
      }),
    })
    const body = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }
    if (!body.access_token) return null
    await saveGithubIdentity({
      userId,
      githubUserId: identity.githubUserId,
      login: identity.login,
      avatarUrl: identity.avatarUrl,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? identity.refreshToken,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
    })
    return body.access_token
  } catch (error) {
    console.error('[github-identity] token refresh failed:', error)
    return null
  }
}

export type GithubConnection = {
  loginEnabled: boolean
  connected: boolean
  login: string | null
  repos: { fullName: string; private: boolean; defaultBranch: string }[]
  installUrl: string
  error: string | null
}

/**
 * A user's GitHub connection and the repositories they could post a job on —
 * the intersection of "you can see it" and "our App is installed on it".
 *
 * Takes the user id explicitly (rather than reading a session) so the MCP
 * connector, which authenticates with a bearer token and has no browser
 * session, gets exactly the same answer the web UI does.
 */
export async function githubConnectionFor(userId: string | null): Promise<GithubConnection> {
  const { isGithubLoginEnabled } = await import('@/lib/github-oauth')
  const { appInstallUrl } = await import('@/lib/github-app')
  const base: GithubConnection = {
    loginEnabled: await isGithubLoginEnabled(),
    connected: false,
    login: null,
    repos: [],
    installUrl: appInstallUrl(),
    error: null,
  }
  if (!userId) return { ...base, error: 'Sign in first.' }

  const identity = await getGithubIdentity(userId)
  if (!identity) return base

  const token = await githubUserToken(userId)
  if (!token) {
    return { ...base, connected: true, login: identity.login, error: 'Your GitHub authorization expired — reconnect.' }
  }
  try {
    const { listUserInstallationRepos } = await import('@/lib/github-app')
    return { ...base, connected: true, login: identity.login, repos: await listUserInstallationRepos(token) }
  } catch (error) {
    return {
      ...base,
      connected: true,
      login: identity.login,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
