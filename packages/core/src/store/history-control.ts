let sceneHistoryPauseDepth = 0

type TemporalStoreLike = {
  temporal: {
    getState(): {
      pause(): void
      resume(): void
    }
  }
}

export function pauseSceneHistory(sceneStore: TemporalStoreLike): void {
  if (sceneHistoryPauseDepth === 0) {
    sceneStore.temporal.getState().pause()
  }
  sceneHistoryPauseDepth += 1
}

export function resumeSceneHistory(sceneStore: TemporalStoreLike): void {
  if (sceneHistoryPauseDepth === 0) {
    return
  }

  sceneHistoryPauseDepth -= 1
  if (sceneHistoryPauseDepth === 0) {
    sceneStore.temporal.getState().resume()
  }
}

export function getSceneHistoryPauseDepth(): number {
  return sceneHistoryPauseDepth
}

export function resetSceneHistoryPauseDepth(): void {
  sceneHistoryPauseDepth = 0
}
