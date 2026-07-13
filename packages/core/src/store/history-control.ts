let sceneHistoryPauseDepth = 0

type TemporalStoreLike = {
  temporal: {
    getState(): {
      pause(): void
      resume(): void
    }
  }
}

type TemporalHistoryStoreLike<TPastState> = {
  temporal: {
    getState(): {
      pastStates: TPastState[]
    }
    setState(state: { pastStates: TPastState[] }): void
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

function retainedPastStateCount<TPastState>(before: TPastState[], after: TPastState[]): number {
  for (let start = 0; start < before.length; start += 1) {
    const retained = before.length - start
    if (retained > after.length) continue
    let matches = true
    for (let index = 0; index < retained; index += 1) {
      if (before[start + index] !== after[index]) {
        matches = false
        break
      }
    }
    if (matches) return retained
  }
  return 0
}

export function runAsSingleSceneHistoryStep<TPastState, TResult>(
  sceneStore: TemporalHistoryStoreLike<TPastState>,
  run: () => TResult,
): TResult {
  const beforePastStates = sceneStore.temporal.getState().pastStates
  const result = run()
  const afterPastStates = sceneStore.temporal.getState().pastStates
  const retainedCount = retainedPastStateCount(beforePastStates, afterPastStates)
  const addedCount = afterPastStates.length - retainedCount
  if (addedCount > 1) {
    const firstAddedState = afterPastStates[retainedCount]
    if (firstAddedState !== undefined) {
      sceneStore.temporal.setState({
        pastStates: [...afterPastStates.slice(0, retainedCount), firstAddedState],
      })
    }
  }
  return result
}
