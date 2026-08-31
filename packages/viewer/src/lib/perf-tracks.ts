// Shared sink for `?perf` instrumentation.
//
// Two outputs from one call site:
//  1. Chrome DevTools Performance panel custom tracks — every span becomes a
//     `performance.measure` with a `detail.devtools` payload, so Pascal systems
//     show up as named lanes in the flame chart while recording.
//  2. Per-window aggregates — `drainPerfCounters()` hands the overlay one
//     bucket per track (total/max/count since the last drain), so the panel can
//     print "wall-csg 9.8ms" without touching the timeline.
//
// Everything is gated on PERF_OVERLAY_ENABLED: when `?perf` is absent the
// helpers reduce to calling `fn()` directly / returning early, so hot paths pay
// only a boolean check. Measures otherwise accumulate in the browser's
// timeline buffer indefinitely — the overlay is responsible for calling
// `clearPerfMeasures()` on its drain tick.

import { PERF_OVERLAY_ENABLED } from './gpu-perf'

export type PerfCounterBucket = {
  totalMs: number
  maxMs: number
  count: number
}

/** DevTools palette names accepted by the extensibility API. */
export type PerfTrackColor =
  | 'primary'
  | 'primary-light'
  | 'primary-dark'
  | 'secondary'
  | 'secondary-light'
  | 'secondary-dark'
  | 'tertiary'
  | 'tertiary-light'
  | 'tertiary-dark'
  | 'error'

const counters = new Map<string, PerfCounterBucket>()

function record(track: string, ms: number): void {
  const bucket = counters.get(track)
  if (bucket) {
    bucket.totalMs += ms
    bucket.count += 1
    if (ms > bucket.maxMs) bucket.maxMs = ms
  } else {
    counters.set(track, { totalMs: ms, maxMs: ms, count: 1 })
  }
}

function emitMeasure(
  track: string,
  name: string,
  start: number,
  end: number,
  color: PerfTrackColor,
  properties?: Array<[string, string]>,
): void {
  try {
    performance.measure(name, {
      start,
      end,
      detail: {
        devtools: {
          dataType: 'track-entry',
          track,
          trackGroup: 'Pascal',
          color,
          ...(properties ? { properties } : {}),
        },
      },
    })
  } catch {
    // Older browsers reject the options bag — aggregates still work.
  }
}

/**
 * Time a synchronous block and file it under `track`. The label defaults to
 * the track name; pass `name` for per-entry granularity (e.g. a node id) —
 * it only affects the DevTools lane, not the aggregate bucket.
 */
export function timeSpan<T>(
  track: string,
  fn: () => T,
  opts?: { name?: string; color?: PerfTrackColor; properties?: Array<[string, string]> },
): T {
  if (!PERF_OVERLAY_ENABLED) return fn()
  const start = performance.now()
  try {
    return fn()
  } finally {
    const end = performance.now()
    record(track, end - start)
    emitMeasure(track, opts?.name ?? track, start, end, opts?.color ?? 'primary', opts?.properties)
  }
}

/**
 * Span for non-callback shapes (spans crossing await points or frames).
 * `beginSpan` returns null when perf is off — callers pass the handle back to
 * `endSpan`, which no-ops on null.
 */
export type PerfSpanHandle = { track: string; name: string; start: number; color: PerfTrackColor }

export function beginSpan(
  track: string,
  opts?: { name?: string; color?: PerfTrackColor },
): PerfSpanHandle | null {
  if (!PERF_OVERLAY_ENABLED) return null
  return {
    track,
    name: opts?.name ?? track,
    start: performance.now(),
    color: opts?.color ?? 'primary',
  }
}

export function endSpan(handle: PerfSpanHandle | null, properties?: Array<[string, string]>): void {
  if (!handle) return
  const end = performance.now()
  record(handle.track, end - handle.start)
  emitMeasure(handle.track, handle.name, handle.start, end, handle.color, properties)
}

/** Record a duration measured externally (no measure emitted). */
export function recordPerfSample(track: string, ms: number): void {
  if (!PERF_OVERLAY_ENABLED) return
  record(track, ms)
}

/** Hand the current window's buckets to the overlay and start a new window. */
export function drainPerfCounters(): Map<string, PerfCounterBucket> {
  const out = new Map(counters)
  counters.clear()
  return out
}

/** Drop accumulated timeline entries so long `?perf` sessions don't leak. */
export function clearPerfMeasures(): void {
  try {
    performance.clearMeasures()
    performance.clearMarks()
  } catch {
    // ignore
  }
}
