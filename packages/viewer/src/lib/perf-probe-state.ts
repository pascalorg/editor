// Read-only state for scripted `?perf` receipts (bench/next-house, scripts/perf): the scene
// history and the viewer selection, so production builds can report undo entries and
// history pauses without dev-only store handles.

import { getSceneHistoryPauseDepth } from '@pascal-app/core'

type TemporalLike = {
  temporal: {
    getState(): {
      pastStates: readonly unknown[]
      futureStates: readonly unknown[]
      isTracking: boolean
    }
  }
}

type SelectionLike = {
  getState(): {
    selection: {
      buildingId: string | null
      levelId: string | null
      zoneId: string | null
      selectedIds: readonly string[]
    }
  }
}

export type PerfHistoryState = {
  /** Undo entries. */
  past: number
  /** Redo entries. */
  future: number
  /** False while any owner has history paused. */
  tracking: boolean
  /** Refcounted pause owners (`pauseSceneHistory` + leases); direct `temporal.pause()` is not counted. */
  pauseDepth: number
}

export type PerfSelectionState = {
  buildingId: string | null
  levelId: string | null
  zoneId: string | null
  selectedIds: string[]
}

export function readPerfHistory(store: TemporalLike): PerfHistoryState {
  const temporal = store.temporal.getState()
  return {
    past: temporal.pastStates.length,
    future: temporal.futureStates.length,
    tracking: temporal.isTracking,
    pauseDepth: getSceneHistoryPauseDepth(),
  }
}

export function readPerfSelection(store: SelectionLike): PerfSelectionState {
  const { buildingId, levelId, zoneId, selectedIds } = store.getState().selection
  return { buildingId, levelId, zoneId, selectedIds: [...selectedIds] }
}
