/**
 * The worker fleet as a reconciled, declarative system — Kubernetes'
 * controller pattern applied to the part of this platform that IS a fleet.
 *
 * The mapping is structural, not cosmetic:
 *
 *   K8s concept        here
 *   ──────────────     ────────────────────────────────────────────────
 *   pod                a worker agent (one runtime, one identity/key)
 *   liveness probe     the local worker's poll heartbeat (lastPollAt)
 *   readiness          provisioned wallet + issued key + configured runtime
 *   resource limits    per-job budget = the bounty (enforced in foreman);
 *                      per-owner spending caps (walletMaxTxUsd/DailyCap)
 *   controller loop    the ops heartbeat reconciling desired vs observed —
 *                      previously these ticks only ran when a USER happened
 *                      to load a page, which is not a control loop, it is
 *                      luck. Now the cron drives them unconditionally.
 *   kubectl get pods   GET /api/fleet
 *
 * Pure classification lives here (tested); the actuator calls stay in the
 * cron route where the other sweeps live.
 */

export type WorkerPhase = 'Ready' | 'NotReady' | 'Offline' | 'Unschedulable'

export type WorkerObservation = {
  runtimeType: string | null
  /** Local workers heartbeat by polling; null = never polled. */
  lastPollAt: Date | null
  provisioned: boolean
  hasKey: boolean
  autoMine: boolean
}

export type WorkerStatus = {
  phase: WorkerPhase
  /** One human sentence — the `kubectl describe` line. */
  reason: string
  /** Heartbeat age in seconds, for local workers; null where liveness is
   *  not probe-based (cloud/mcp/platform are invoked by us, not polling). */
  heartbeatAgeSec: number | null
}

/** Liveness thresholds for poll-based (local) workers. A desktop miner polls
 *  every few seconds while mining; 2 minutes of silence means it is gone in
 *  every way that matters for scheduling. */
export const LIVENESS_STALE_SEC = 120
export const LIVENESS_DEAD_SEC = 10 * 60

export function classifyWorker(w: WorkerObservation, now: Date): WorkerStatus {
  // Readiness gates come first: an unprovisioned or keyless worker cannot be
  // scheduled no matter how alive it is.
  if (!w.provisioned) {
    return { phase: 'Unschedulable', reason: 'no wallet provisioned — cannot accept escrowed work', heartbeatAgeSec: null }
  }
  if (!w.hasKey) {
    return { phase: 'Unschedulable', reason: 'no per-agent key issued — callbacks cannot be authenticated', heartbeatAgeSec: null }
  }

  const type = w.runtimeType ?? 'platform'
  if (type === 'local') {
    if (!w.lastPollAt) return { phase: 'Offline', reason: 'local worker has never polled', heartbeatAgeSec: null }
    const age = Math.floor((now.getTime() - w.lastPollAt.getTime()) / 1000)
    if (age <= LIVENESS_STALE_SEC) return { phase: 'Ready', reason: 'heartbeat current', heartbeatAgeSec: age }
    if (age <= LIVENESS_DEAD_SEC) {
      return { phase: 'NotReady', reason: `heartbeat stale (${age}s) — grace before Offline`, heartbeatAgeSec: age }
    }
    return { phase: 'Offline', reason: `no heartbeat for ${Math.floor(age / 60)}m`, heartbeatAgeSec: age }
  }

  // cloud / mcp / webhook / platform workers are invoked BY the platform —
  // liveness is not probe-based, readiness is configuration.
  return { phase: 'Ready', reason: `${type} runtime — invoked on demand, no heartbeat needed`, heartbeatAgeSec: null }
}

/**
 * The HPA analog, inverted for a labor market: we do not scale pods (workers
 * belong to their owners), we scale ATTENTION — how many controller-driven
 * claim ticks a reconcile pass should attempt, from queue depth. Zero when
 * the board is empty; bounded so a flooded board cannot stampede the chain.
 */
export function reconcileTicks(openJobs: number, maxPerPass = 4): number {
  if (!Number.isFinite(openJobs) || openJobs <= 0) return 0
  return Math.min(maxPerPass, Math.ceil(openJobs / 3))
}

export type FleetSummary = {
  total: number
  byPhase: Record<WorkerPhase, number>
  autoMiners: number
}

export function summarizeFleet(statuses: Array<{ status: WorkerStatus; autoMine: boolean }>): FleetSummary {
  const byPhase: Record<WorkerPhase, number> = { Ready: 0, NotReady: 0, Offline: 0, Unschedulable: 0 }
  let autoMiners = 0
  for (const s of statuses) {
    byPhase[s.status.phase]++
    if (s.autoMine) autoMiners++
  }
  return { total: statuses.length, byPhase, autoMiners }
}
