import { useEffect, useState } from 'react'

export const SCENE_READY_FALLBACK_MS = 8000
export const SCENE_DATA_FALLBACK_MS = 20_000

export interface SceneLoaderInput {
  /** Host `isLoading`, the editor's own load in flight, or no scene loaded yet. */
  isSceneDataLoading: boolean
  /** The viewer has reported the current scene built and rendered. */
  isViewerSceneReady: boolean
  /** A failed load keeps its error surface (and retry) up: no fallback applies. */
  hasLoadError: boolean
  /** Changes on every load start and completion, so each gets its own fallback. */
  loadKey: string | number
  viewerReadyTimeoutMs?: number
  dataLoadTimeoutMs?: number
}

/**
 * Whether the full-pane scene loader shows. It covers the panes and takes their
 * pointer events, so it must come down even when a readiness signal never
 * arrives: a fallback timer runs whenever the loader is up for anything but a
 * load error, and once it fires the loader stays down for that load — a viewer
 * that mounts late (its renderer resolving after the timeout under software
 * WebGL) reports "not ready" on mount, which must not put it back.
 */
export function useSceneLoader({
  isSceneDataLoading,
  isViewerSceneReady,
  hasLoadError,
  loadKey,
  viewerReadyTimeoutMs = SCENE_READY_FALLBACK_MS,
  dataLoadTimeoutMs = SCENE_DATA_FALLBACK_MS,
}: SceneLoaderInput): boolean {
  const [timedOutKey, setTimedOutKey] = useState<string | number | null>(null)
  const waiting = isSceneDataLoading || !isViewerSceneReady
  const timedOut = timedOutKey === loadKey

  useEffect(() => {
    if (!waiting || hasLoadError || timedOut) return
    const timer = window.setTimeout(
      () => {
        console.warn(
          isSceneDataLoading
            ? '[editor] scene data loading timed out; showing editor shell anyway'
            : '[editor] viewer scene readiness timed out; showing editor shell anyway',
          { loadKey },
        )
        setTimedOutKey(loadKey)
      },
      isSceneDataLoading ? dataLoadTimeoutMs : viewerReadyTimeoutMs,
    )
    return () => window.clearTimeout(timer)
  }, [
    waiting,
    hasLoadError,
    timedOut,
    isSceneDataLoading,
    loadKey,
    viewerReadyTimeoutMs,
    dataLoadTimeoutMs,
  ])

  return hasLoadError || (waiting && !timedOut)
}
