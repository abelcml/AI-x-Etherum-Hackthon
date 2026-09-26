/**
 * The fleet controller's pure decisions: pod-phase classification, liveness
 * thresholds, and the queue-depth reconcile scaling (the HPA analog).
 */
import { describe, expect, it } from 'vitest'
import {
  LIVENESS_DEAD_SEC,
  LIVENESS_STALE_SEC,
  classifyWorker,
  reconcileTicks,
  summarizeFleet,
} from '@/lib/worker-fleet'
import { callbackSecretMatches } from '@/lib/webhook'

const now = new Date('2026-07-26T12:00:00Z')
const ago = (sec: number) => new Date(now.getTime() - sec * 1000)
const base = { runtimeType: 'local', provisioned: true, hasKey: true, autoMine: false, lastPollAt: ago(5) }

describe('classifyWorker — readiness gates before liveness', () => {
  it('an unprovisioned worker is Unschedulable no matter how alive', () => {
    expect(classifyWorker({ ...base, provisioned: false }, now).phase).toBe('Unschedulable')
  })
  it('a keyless worker is Unschedulable — callbacks cannot be authenticated', () => {
    expect(classifyWorker({ ...base, hasKey: false }, now).phase).toBe('Unschedulable')
  })
})

describe('classifyWorker — local liveness ladder', () => {
  it('fresh heartbeat → Ready with age reported', () => {
    const s = classifyWorker({ ...base, lastPollAt: ago(30) }, now)
    expect(s.phase).toBe('Ready')
    expect(s.heartbeatAgeSec).toBe(30)
  })
  it('stale heartbeat → NotReady (grace), dead heartbeat → Offline', () => {
    expect(classifyWorker({ ...base, lastPollAt: ago(LIVENESS_STALE_SEC + 1) }, now).phase).toBe('NotReady')
    expect(classifyWorker({ ...base, lastPollAt: ago(LIVENESS_DEAD_SEC + 1) }, now).phase).toBe('Offline')
  })
  it('never polled → Offline, not Ready-by-default', () => {
    expect(classifyWorker({ ...base, lastPollAt: null }, now).phase).toBe('Offline')
  })
})

describe('classifyWorker — invoked runtimes have no probe', () => {
  it.each(['cloud', 'mcp', 'webhook', 'platform', null])('%s is Ready when provisioned+keyed', (rt) => {
    const s = classifyWorker({ ...base, runtimeType: rt as string | null, lastPollAt: null }, now)
    expect(s.phase).toBe('Ready')
    expect(s.heartbeatAgeSec).toBeNull()
  })
})

describe('reconcileTicks — scale attention by queue depth, bounded', () => {
  it('does nothing on an empty board and saturates on a flooded one', () => {
    expect(reconcileTicks(0)).toBe(0)
    expect(reconcileTicks(1)).toBe(1)
    expect(reconcileTicks(6)).toBe(2)
    expect(reconcileTicks(1000)).toBe(4) // the stampede bound
  })
})

describe('summarizeFleet', () => {
  it('counts phases and auto-miners', () => {
    const s = summarizeFleet([
      { status: classifyWorker(base, now), autoMine: true },
      { status: classifyWorker({ ...base, lastPollAt: null }, now), autoMine: false },
      { status: classifyWorker({ ...base, hasKey: false }, now), autoMine: true },
    ])
    expect(s.total).toBe(3)
    expect(s.byPhase.Ready).toBe(1)
    expect(s.byPhase.Offline).toBe(1)
    expect(s.byPhase.Unschedulable).toBe(1)
    expect(s.autoMiners).toBe(2)
  })
})

describe('callbackSecretMatches — the per-agent key gate', () => {
  it('strict auth accepts exactly the per-agent key', () => {
    const auth = { required: true as const, secret: 'per-agent' }
    expect(callbackSecretMatches(auth, 'per-agent')).toBe(true)
    expect(callbackSecretMatches(auth, 'shared')).toBe(false)
    expect(callbackSecretMatches(auth, null)).toBe(false)
  })
  it('transition auth accepts the per-agent key OR the legacy shared secret, nothing else', () => {
    const auth = { required: true as const, secret: 'per-agent', alsoAccept: 'shared' }
    expect(callbackSecretMatches(auth, 'per-agent')).toBe(true)
    expect(callbackSecretMatches(auth, 'shared')).toBe(true)
    expect(callbackSecretMatches(auth, 'wrong')).toBe(false)
  })
  it('open dev mode (no secret configured) accepts anything', () => {
    expect(callbackSecretMatches({ required: false }, null)).toBe(true)
  })

  // The comparison is constant-time via SHA-256 digests. timingSafeEqual THROWS
  // on unequal buffer lengths, so the cases that would have thrown had the raw
  // strings been passed are the ones worth pinning: a guess is any length, and
  // alsoAccept is a second key of unrelated length.
  it('rejects guesses of every length without throwing', () => {
    const auth = { required: true as const, secret: 'per-agent' }
    for (const guess of ['', 'x', 'per-agen', 'per-agentt', 'x'.repeat(4096)]) {
      expect(callbackSecretMatches(auth, guess)).toBe(false)
    }
  })

  it('compares against a legacy secret of a different length without throwing', () => {
    const auth = { required: true as const, secret: 'a'.repeat(64), alsoAccept: 'short' }
    expect(callbackSecretMatches(auth, 'short')).toBe(true)
    expect(callbackSecretMatches(auth, 'a'.repeat(64))).toBe(true)
    expect(callbackSecretMatches(auth, 'a'.repeat(63))).toBe(false)
  })

  it('still forgives the trailing newline a pasted CI secret carries', () => {
    const auth = { required: true as const, secret: 'per-agent' }
    expect(callbackSecretMatches(auth, ' per-agent\n')).toBe(true)
  })

  it('does not accept an empty presented secret against an empty configured one', () => {
    // resolveCallbackAuth can hand back secret:'' if RUNTIME_SHARED_SECRET is
    // set to a blank string; digest equality would say those match, and a
    // callback presenting nothing would authenticate.
    expect(callbackSecretMatches({ required: true, secret: '' }, '')).toBe(false)
  })
})
