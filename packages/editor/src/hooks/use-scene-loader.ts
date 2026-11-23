import { useEffect, useLayoutEffect, useState } from 'react'

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export const SCENE_READY_FALLBACK_MS = 8000
export const SCENE_DATA_FALLBACK_MS = 20_000

/**
 * Set on `document.documentElement` while the editor is mounted. Unlike the
 * loader (`[data-scene-loading]`), which a fallback can take down early, this
 * tracks only the editor's own scene data load:
 * - `loading`: the load is in flight; the scene is read-only and autosave is paused.
 * - `ready`: the scene loaded; it is editable and autosave runs.
 * - `failed`: the load failed; the scene stays read-only until a retry loads it.
 */
export const SCENE_DATA_ATTRIBUTE = 'data-scene-data'

export type SceneDataState = 'loading' | 'ready' | 'failed'

export interface SceneLoaderInput {
  /** The host's `isLoading`. */
  isHostLoading: boolean
  /** The editor's own load is in flight, or no scene has loaded yet. */
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

export interface SceneLoaderState {
  showLoader: boolean
  sceneData: SceneDataState
}

/**
 * Whether the full-pane scene loader shows, and the state of the scene data
 * behind it. The loader covers the panes and takes their pointer events, so it
 * must come down even when a readiness signal never arrives: a fallback timer
 * runs whenever the loader is up for anything but a load error, and once it
 * fires the loader stays down for that load — a viewer that mounts late (its
 * renderer resolving after the timeout under software WebGL) reports "not
 * ready" on mount, which must not put it back. The scene data state is not
 * subject to that fallback.
 */
export function useSceneLoader({
  isHostLoading,
  isSceneDataLoading,
  isViewerSceneReady,
  hasLoadError,
  loadKey,
  viewerReadyTimeoutMs = SCENE_READY_FALLBACK_MS,
  dataLoadTimeoutMs = SCENE_DATA_FALLBACK_MS,
}: SceneLoaderInput): SceneLoaderState {
  const [timedOutKey, setTimedOutKey] = useState<string | number | null>(null)
  const isDataLoading = isHostLoading || isSceneDataLoading
  const waiting = isDataLoading || !isViewerSceneReady
  const timedOut = timedOutKey === loadKey
  const sceneData: SceneDataState = hasLoadError
    ? 'failed'
    : isSceneDataLoading
      ? 'loading'
      : 'ready'

  useEffect(() => {
    if (!waiting || hasLoadError || timedOut) return
    const timer = window.setTimeout(
      () => {
        console.warn(
          isDataLoading
            ? '[editor] scene data loading timed out; showing editor shell anyway'
            : '[editor] viewer scene readiness timed out; showing editor shell anyway',
          { loadKey },
        )
        setTimedOutKey(loadKey)
      },
      isDataLoading ? dataLoadTimeoutMs : viewerReadyTimeoutMs,
    )
    return () => window.clearTimeout(timer)
  }, [
    waiting,
    hasLoadError,
    timedOut,
    isDataLoading,
    loadKey,
    viewerReadyTimeoutMs,
    dataLoadTimeoutMs,
  ])

  // Layout effects, so the attribute never lags the committed state by a paint.
  useClientLayoutEffect(() => {
    document.documentElement.setAttribute(SCENE_DATA_ATTRIBUTE, sceneData)
  }, [sceneData])
  useClientLayoutEffect(
    () => () => document.documentElement.removeAttribute(SCENE_DATA_ATTRIBUTE),
    [],
  )

  return { showLoader: hasLoadError || (waiting && !timedOut), sceneData }
}
