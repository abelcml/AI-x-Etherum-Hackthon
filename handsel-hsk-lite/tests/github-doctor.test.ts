import { describe, it, expect } from 'vitest'
import { classifyAppEvents, classifyDeliveries, REQUIRED_APP_EVENTS } from '@/lib/github-doctor'

// The doctor exists because these exact states happened in production and
// were invisible: an App with the Issues permission but no Issues event
// subscription silently never receives label webhooks.

describe('classifyAppEvents', () => {
  it('passes when every consumed event is subscribed', () => {
    const c = classifyAppEvents(['issues', 'pull_request', 'check_suite', 'check_run'])
    expect(c.status).toBe('pass')
  })

  it('fails and names the missing event (the real outage shape)', () => {
    const c = classifyAppEvents(['pull_request', 'check_suite'])
    expect(c.status).toBe('fail')
    expect(c.detail).toContain('issues')
    // The fix lives in App settings, and event subscriptions need no
    // installation re-approval — the check must say so, or the operator
    // goes hunting for an approval flow that doesn't exist.
    expect(c.detail).toContain('Subscribe to events')
  })

  it('fails on an undefined event list rather than guessing', () => {
    const c = classifyAppEvents(undefined)
    expect(c.status).toBe('fail')
    for (const e of REQUIRED_APP_EVENTS) expect(c.detail).toContain(e)
  })
})

describe('classifyDeliveries', () => {
  const d = (event: string, status_code: number) => ({
    event,
    action: null,
    status_code,
    delivered_at: '2026-07-26T00:00:00Z',
    redelivery: false,
  })

  it('warns (not fails) on zero deliveries — quiet is not broken', () => {
    expect(classifyDeliveries([]).status).toBe('warn')
  })

  it('passes on all-2xx and reports event mix', () => {
    const c = classifyDeliveries([d('issues', 200), d('check_suite', 200), d('issues', 202)])
    expect(c.status).toBe('pass')
    expect(c.detail).toContain('issues×2')
  })

  it('fails when any delivery got a non-2xx response', () => {
    const c = classifyDeliveries([d('issues', 401), d('pull_request', 200)])
    expect(c.status).toBe('fail')
    expect(c.detail).toContain('401')
  })
})
