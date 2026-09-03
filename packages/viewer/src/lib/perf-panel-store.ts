// Bridge between the in-canvas collector (perf-monitor.tsx, R3F reconciler)
// and the DOM panel (perf-panel.tsx). react-dom portals can't cross the R3F
// renderer boundary, so the collector publishes here and the panel — mounted
// outside <Canvas> — subscribes via useSyncExternalStore.

import { useSyncExternalStore } from 'react'

export type PerfTrackLine = { name: string; totalMs: number; count: number; maxMs: number }

export type PerfStats = {
  fps: number
  frameMs: number
  frameMaxMs: number
  encodeMs: number
  encodeMaxMs: number
  gpuMs: number
  gpuMaxMs: number
  gpuTracked: boolean
  queueMs: number
  queueMaxMs: number
  drawCalls: number
  triangles: number
  batch: PerfBatchStats
  dirty: number
  dirtyDetail: string
  geometries: number
  textures: number
  gpuBytes: number
  heapBytes: number
  meshes: number
  lines: number
  sprites: number
  lights: number
  tracks: PerfTrackLine[]
}

let current: PerfStats | null = null
const listeners = new Set<() => void>()

export function publishPerfStats(stats: PerfStats): void {
  current = stats
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePerfStats(): PerfStats | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}

/**
 * Batch membership, published by the batch systems themselves (the panel's
 * collector cannot read their stores across packages). Stable truth — items
 * and instances currently drawn through batch containers — unlike the
 * per-pass `_multiDrawCount`, which snapshots whichever camera (main, shadow,
 * outline) culled the batch last and flips between passes. On WebGPU each
 * batched instance still counts once in `drawCalls` (the backend loops
 * drawIndexed per visible instance), so without this row a batched scene
 * looks no cheaper than an unbatched one — the saving is encode cost per
 * call, not call count.
 */
export type PerfBatchStats = { items: number; instances: number; containers: number }

let batchStats: PerfBatchStats = { items: 0, instances: 0, containers: 0 }

export function publishPerfBatchStats(stats: PerfBatchStats): void {
  batchStats = stats
}

export function readPerfBatchStats(): PerfBatchStats {
  return batchStats
}
