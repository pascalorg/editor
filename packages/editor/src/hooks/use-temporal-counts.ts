import { useScene } from '@pascal-app/core'
import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => useScene.temporal.subscribe(onChange)
const getCanUndo = () => useScene.temporal.getState().pastStates.length > 0
const getCanRedo = () => useScene.temporal.getState().futureStates.length > 0
const serverFalse = () => false

/**
 * Reactive undo/redo availability, backed by the zundo temporal store. The
 * temporal store exposes no React hook of its own, so this subscribes directly.
 * `runUndo` / `runRedo` (from `@pascal-app/editor`) are the matching actions.
 */
export function useTemporalCounts(): { canUndo: boolean; canRedo: boolean } {
  const canUndo = useSyncExternalStore(subscribe, getCanUndo, serverFalse)
  const canRedo = useSyncExternalStore(subscribe, getCanRedo, serverFalse)
  return { canUndo, canRedo }
}
