// Action-cost ledger for `?perf`.
//
// An "action" is one user edit gesture: a wall-endpoint drag, a door move, an
// undo, a level switch. The editor package brackets the gesture with
// `beginPerfAction` / `commitPerfAction`; every perf-tracks sample recorded in
// between (wall-csg, geometry, react-render, gpu-render, …) is attributed to
// it. The action is "settled" only when the scene has finished digesting the
// edit: dirty queue empty, deferred wall neighbour rebuilds flushed, and one
// more GPU sample resolved after that — i.e. the user actually sees the final
// result. The settle system in the viewer feeds that state per frame via
// `notifyPerfActionFrame`.
//
// Everything is a no-op without `?perf`.

import { useSyncExternalStore } from 'react'
import { PERF_OVERLAY_ENABLED } from './gpu-perf'
import { subscribePerfSamples } from './perf-tracks'

export type PerfActionReceipt = {
  name: string
  /** Free-form context, e.g. the node id or kind. */
  detail: string
  /** begin → commit (the human gesture; 0 for instant actions like undo). */
  dragMs: number
  /** commit → fully settled (rebuilds + one GPU sample after quiet). */
  settleMs: number
  /** begin → settled. */
  totalMs: number
  /** Frames observed between commit and settled. */
  settleFrames: number
  /** Per-track attribution over begin → settled, sorted by totalMs desc. */
  tracks: Array<{ name: string; totalMs: number; count: number }>
  outcome: 'settled' | 'interrupted' | 'timeout'
  endedAt: number
}

type ActiveAction = {
  name: string
  detail: string
  startedAt: number
  committedAt: number | null
  settleFrames: number
  /** Set once dirty+pending hit zero after commit; we then wait for one GPU sample. */
  awaitingGpu: boolean
  buckets: Map<string, { totalMs: number; count: number }>
  unsubscribe: () => void
}

const SETTLE_TIMEOUT_MS = 5000
// A gesture that begins and never commits (a hover preview, a drag whose
// pointerup never reached the caller) is never settle-checked, so without an
// absolute cap it would hold its sample subscription — and keep growing its
// buckets — for the rest of the session.
const UNCOMMITTED_TIMEOUT_MS = 60_000
const MAX_RECEIPTS = 5

let active: ActiveAction | null = null
let receipts: PerfActionReceipt[] = []
const listeners = new Set<() => void>()

function emitReceipts(): void {
  for (const listener of listeners) listener()
}

function finalize(outcome: PerfActionReceipt['outcome']): void {
  const action = active
  if (!action) return
  active = null
  action.unsubscribe()
  const now = performance.now()
  const committedAt = action.committedAt ?? now
  const receipt: PerfActionReceipt = {
    name: action.name,
    detail: action.detail,
    dragMs: committedAt - action.startedAt,
    settleMs: now - committedAt,
    totalMs: now - action.startedAt,
    settleFrames: action.settleFrames,
    tracks: [...action.buckets.entries()]
      .map(([name, b]) => ({ name, totalMs: b.totalMs, count: b.count }))
      .sort((a, b) => b.totalMs - a.totalMs),
    outcome,
    endedAt: now,
  }
  receipts = [receipt, ...receipts].slice(0, MAX_RECEIPTS)
  emitReceipts()
  // One timeline entry per action so recordings show the full span with its
  // breakdown attached.
  try {
    performance.measure(`${action.name}${action.detail ? ` ${action.detail}` : ''}`, {
      start: action.startedAt,
      end: now,
      detail: {
        devtools: {
          dataType: 'track-entry',
          track: 'Actions',
          trackGroup: 'Pascal',
          color: outcome === 'settled' ? 'secondary' : 'error',
          properties: [
            ['outcome', outcome],
            ['drag ms', receipt.dragMs.toFixed(1)],
            ['settle ms', receipt.settleMs.toFixed(1)],
            ...receipt.tracks
              .slice(0, 6)
              .map((t): [string, string] => [t.name, `${t.totalMs.toFixed(1)}ms (${t.count}×)`]),
          ],
        },
      },
    })
  } catch {}
  // eslint-disable-next-line no-console
  console.log(
    `[perf] ${action.name}${action.detail ? ` (${action.detail})` : ''}: ` +
      `${receipt.totalMs.toFixed(0)}ms total — drag ${receipt.dragMs.toFixed(0)}, ` +
      `settle ${receipt.settleMs.toFixed(0)} over ${receipt.settleFrames} frames [${outcome}] — ` +
      receipt.tracks
        .slice(0, 6)
        .map((t) => `${t.name} ${t.totalMs.toFixed(1)}ms`)
        .join(', '),
  )
}

/** Start attributing samples to a named action. Interrupts any active one. */
export function beginPerfAction(name: string, detail = ''): void {
  if (!PERF_OVERLAY_ENABLED) return
  if (active) finalize('interrupted')
  const buckets = new Map<string, { totalMs: number; count: number }>()
  active = {
    name,
    detail,
    startedAt: performance.now(),
    committedAt: null,
    settleFrames: 0,
    awaitingGpu: false,
    buckets,
    unsubscribe: subscribePerfSamples((track, ms) => {
      const bucket = buckets.get(track)
      if (bucket) {
        bucket.totalMs += ms
        bucket.count += 1
      } else {
        buckets.set(track, { totalMs: ms, count: 1 })
      }
      // A GPU sample landing after the quiet point is the settle signal.
      if (active?.awaitingGpu && track === 'gpu-render') finalize('settled')
    }),
  }
}

/** The gesture ended (pointer up / operation dispatched); settling begins. */
export function commitPerfAction(): void {
  if (!active || active.committedAt !== null) return
  active.committedAt = performance.now()
}

/** The gesture was aborted (Escape mid-drag); discard without a settle wait. */
export function cancelPerfAction(): void {
  if (!active) return
  finalize('interrupted')
}

/** Convenience for instant actions (undo, level switch): begin + commit. */
export function markPerfAction(name: string, detail = ''): void {
  beginPerfAction(name, detail)
  commitPerfAction()
}

/**
 * Whether an action is currently being attributed. Lets a generic call site
 * (the interaction scope) yield to a more specific one that began first.
 */
export function hasActivePerfAction(): boolean {
  return active !== null
}

/**
 * Called once per frame by the viewer settle system with the current dirty
 * count and the wall system's deferred-neighbour backlog. Also the ledger's
 * only heartbeat, so it is where a stuck action gets released.
 */
export function notifyPerfActionFrame(dirtyCount: number, pendingRebuilds: number): void {
  const action = active
  if (!action) return
  const now = performance.now()
  if (action.committedAt === null) {
    if (now - action.startedAt > UNCOMMITTED_TIMEOUT_MS) finalize('interrupted')
    return
  }
  action.settleFrames += 1
  if (now - action.committedAt > SETTLE_TIMEOUT_MS) {
    finalize('timeout')
    return
  }
  if (!action.awaitingGpu && dirtyCount === 0 && pendingRebuilds === 0) {
    action.awaitingGpu = true
  }
}

// Module-level so the panel's twice-a-second re-render doesn't tear the
// subscription down and rebuild it; `receipts` is replaced, never mutated, so
// the snapshot is stable between finalizes.
function subscribeReceipts(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getReceipts(): PerfActionReceipt[] {
  return receipts
}

export function usePerfActionReceipts(): PerfActionReceipt[] {
  return useSyncExternalStore(subscribeReceipts, getReceipts, getReceipts)
}
