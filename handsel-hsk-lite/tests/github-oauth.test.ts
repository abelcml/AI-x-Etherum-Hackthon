/**
 * GitHub sign-in is an authentication path, so the parts that decide who you
 * become are pinned here: CSRF state, redirect safety, and — the one that
 * matters most — which email may link a GitHub identity to a pre-existing
 * password account.
 */
import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  mintState,
  noreplyEmailFor,
  pickVerifiedEmail,
  safeNextPath,
  verifyState,
} from '@/lib/github-oauth'
import { tokenNeedsRefresh } from '@/lib/github-identity'

const SECRET = 'client-secret'

describe('oauth state', () => {
  it('round-trips the destination when the cookie matches', () => {
    const state = mintState('/jobs', SECRET, 'nonce1')
    expect(verifyState(state, state, SECRET)).toBe('/jobs')
  })

  it('rejects a missing, mismatched, or unsigned state', () => {
    const state = mintState('/jobs', SECRET, 'nonce1')
    expect(verifyState(state, null, SECRET)).toBeNull() // no cookie
    expect(verifyState(state, mintState('/jobs', SECRET, 'nonce2'), SECRET)).toBeNull() // different nonce
    expect(verifyState(state, state, 'other-secret')).toBeNull() // signed by someone else
    expect(verifyState('garbage', 'garbage', SECRET)).toBeNull()
  })

  it('cannot be used to smuggle an off-site redirect', () => {
    const evil = mintState('https://evil.example/steal', SECRET, 'n')
    expect(verifyState(evil, evil, SECRET)).toBe('/')
  })
})

describe('safeNextPath', () => {
  it('allows same-origin paths only', () => {
    expect(safeNextPath('/jobs')).toBe('/jobs')
    expect(safeNextPath('/admin/access?tab=1')).toBe('/admin/access?tab=1')
  })

  it('refuses anything that could leave the origin', () => {
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('https://evil.example')).toBe('/')
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath('')).toBe('/')
  })
})

describe('authorizeUrl', () => {
  it('carries client id, redirect and state', () => {
    const url = new URL(authorizeUrl({ clientId: 'iv1.abc', redirectUri: 'https://x.dev/cb', state: 's' }))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('iv1.abc')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.dev/cb')
    expect(url.searchParams.get('state')).toBe('s')
  })
})

describe('pickVerifiedEmail — the account-takeover gate', () => {
  it('prefers the primary verified address', () => {
    expect(
      pickVerifiedEmail([
        { email: 'other@x.com', primary: false, verified: true },
        { email: 'Me@X.com', primary: true, verified: true },
      ]),
    ).toBe('me@x.com')
  })

  it('falls back to any verified address', () => {
    expect(
      pickVerifiedEmail([
        { email: 'unverified@x.com', primary: true, verified: false },
        { email: 'ok@x.com', primary: false, verified: true },
      ]),
    ).toBe('ok@x.com')
  })

  it('NEVER returns an unverified address — that would let anyone claim a victim\'s account', () => {
    expect(pickVerifiedEmail([{ email: 'victim@corp.com', primary: true, verified: false }])).toBeNull()
    expect(pickVerifiedEmail([])).toBeNull()
    expect(pickVerifiedEmail(null)).toBeNull()
  })
})

describe('noreplyEmailFor', () => {
  it('builds a collision-free placeholder for accounts with no verified email', () => {
    expect(noreplyEmailFor('123', 'Octocat')).toBe('123+octocat@users.noreply.github.com')
  })
})

describe('tokenNeedsRefresh', () => {
  const now = new Date('2026-07-26T00:00:00Z')
  it('treats a non-expiring token as always usable', () => {
    expect(tokenNeedsRefresh(null, now)).toBe(false)
  })
  it('refreshes at or before expiry, allowing for clock skew', () => {
    expect(tokenNeedsRefresh(new Date('2026-07-26T01:00:00Z'), now)).toBe(false)
    expect(tokenNeedsRefresh(new Date('2026-07-26T00:00:30Z'), now)).toBe(true) // inside the 60s skew
    expect(tokenNeedsRefresh(new Date('2026-07-25T23:00:00Z'), now)).toBe(true)
  })
})
