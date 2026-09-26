'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * x402, verifiable instead of illustrated.
 *
 * The explainer next to this one draws the handshake. This one PERFORMS it:
 * pressing the button really does call a priced endpoint from the visitor's
 * own browser, and every value that animates in — the 402 status, the price,
 * the network, the receiving address, the round-trip time — is parsed out of
 * that live response. Nothing here is scripted, so a skeptic can open the
 * network tab and watch the same exchange happen.
 *
 * It deliberately stops where a browser honestly stops: at the challenge. A
 * wallet would sign and retry from here, which is exactly the point — the
 * paywall is machine-to-machine, and the settlements that DID complete are
 * listed underneath, read live from the ledger.
 */

type Step = { id: string; label: string; detail?: string; state: 'idle' | 'active' | 'done' }
type Requirement = { maxAmountRequired?: string; network?: string; payTo?: string; asset?: string; description?: string }
type LiveStats = {
  enabled: boolean
  payTo: string | null
  network: string
  totalPayments: number
  totalUsd: number
  recent: { endpoint: string; payer: string | null; amountUsd: number; paidAt: string }[]
}

const PROBE = '/api/market/index'
const short = (a: string | null) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? '—'))
const usdc = (units?: string) => {
  const n = Number(units)
  return Number.isFinite(n) ? `$${(n / 1_000_000).toFixed(2)}` : '—'
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-1 flex size-2.5 shrink-0 rounded-full transition-colors duration-300 ${
          step.state === 'done' ? 'bg-success' : step.state === 'active' ? 'animate-pulse bg-primary' : 'bg-border'
        }`}
      />
      <div className="min-w-0">
        <p className={`text-sm transition-colors ${step.state === 'idle' ? 'text-muted-foreground' : 'font-medium'}`}>{step.label}</p>
        {step.detail && <p className="break-all font-mono text-xs text-muted-foreground">{step.detail}</p>}
      </div>
    </li>
  )
}

export function X402Live() {
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [ms, setMs] = useState<number | null>(null)
  const [stats, setStats] = useState<LiveStats | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/x402/live')
        .then((r) => r.json())
        .then((d: LiveStats) => alive && setStats(d))
        .catch(() => {})
    load()
    const t = setInterval(load, 20_000)
    return () => {
      alive = false
      clearInterval(t)
      timers.current.forEach(clearTimeout)
    }
  }, [])

  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setMs(null)
    timers.current.forEach(clearTimeout)
    timers.current = []

    const push = (s: Step) => setSteps((prev) => [...prev.map((p) => ({ ...p, state: 'done' as const })), s])
    setSteps([{ id: 'req', label: `GET ${PROBE}`, detail: 'no payment header — asking the server what it costs', state: 'active' }])

    const started = performance.now()
    try {
      const res = await fetch(PROBE, { headers: { accept: 'application/json' } })
      const elapsed = Math.round(performance.now() - started)
      setMs(elapsed)
      const body = await res.json().catch(() => null)

      if (res.status === 402) {
        const req: Requirement = body?.accepts?.[0] ?? {}
        push({ id: 'challenge', label: `402 Payment Required · ${elapsed} ms`, detail: body?.error ?? 'payment required', state: 'active' })
        timers.current.push(
          setTimeout(
            () =>
              push({
                id: 'terms',
                label: `Price ${usdc(req.maxAmountRequired)} USDC on ${req.network ?? 'unknown network'}`,
                detail: `pay to ${short(req.payTo ?? null)} · asset ${short(req.asset ?? null)}`,
                state: 'active',
              }),
            450,
          ),
        )
        timers.current.push(
          setTimeout(() => {
            push({
              id: 'sign',
              label: 'An agent would sign an EIP-3009 authorization and retry',
              detail: 'a browser has no wallet here — settled payments are listed below',
              state: 'active',
            })
            setRunning(false)
          }, 900),
        )
        return
      }

      push({
        id: 'open',
        label: `${res.status} — this deployment is serving the endpoint unpaid`,
        detail: 'X402_PAY_TO is unset, so the paywall is disabled',
        state: 'active',
      })
      setRunning(false)
    } catch (e) {
      push({ id: 'err', label: 'Request failed', detail: e instanceof Error ? e.message : String(e), state: 'active' })
      setRunning(false)
    }
  }, [running])

  return (
    <div className="rounded-xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Run the handshake yourself</h3>
          <p className="text-sm text-muted-foreground">
            Calls a really-priced endpoint from your browser. Every value below is read out of the live response.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {running ? 'Running…' : steps.length ? 'Run again' : 'Send an unpaid request'}
        </button>
      </div>

      {steps.length > 0 && (
        <ul className="mt-4 space-y-2.5 rounded-lg border border-border bg-muted/30 p-4">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-sm font-medium">Settled payments</p>
          {stats && (
            <p className="text-sm text-muted-foreground">
              {stats.totalPayments} paid request{stats.totalPayments === 1 ? '' : 's'} · ${stats.totalUsd.toFixed(2)} collected ·{' '}
              {stats.network}
            </p>
          )}
          {ms !== null && <p className="ml-auto text-xs text-muted-foreground">your challenge round-trip: {ms} ms</p>}
        </div>

        {stats && !stats.enabled ? (
          <p className="mt-2 text-sm text-muted-foreground">The paywall is disabled on this deployment.</p>
        ) : stats && stats.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No machine payments settled yet — a cold start shows as a cold start.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {(stats?.recent ?? []).map((p, i) => (
              <li
                key={`${p.paidAt}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 font-mono text-xs animate-in fade-in-0 slide-in-from-bottom-1 duration-500"
              >
                <span className="truncate">{p.endpoint}</span>
                <span className="shrink-0 text-muted-foreground">{short(p.payer)}</span>
                <span className="shrink-0 font-semibold">${p.amountUsd.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
