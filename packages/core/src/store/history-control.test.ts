import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSceneHistoryPause,
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
} from './history-control'

function temporalStore() {
  const pause = mock(() => {})
  const resume = mock(() => {})
  return {
    pause,
    resume,
    store: { temporal: { getState: () => ({ pause, resume }) } },
  }
}

describe('scene history pause ownership', () => {
  beforeEach(() => resetSceneHistoryPauseDepth())

  test('releases each ownership lease exactly once', () => {
    const { pause, resume, store } = temporalStore()
    const releaseFirst = acquireSceneHistoryPause(store)
    const releaseSecond = acquireSceneHistoryPause(store)

    expect(getSceneHistoryPauseDepth()).toBe(2)
    expect(pause).toHaveBeenCalledTimes(1)
    releaseFirst()
    releaseFirst()
    expect(getSceneHistoryPauseDepth()).toBe(1)
    expect(resume).toHaveBeenCalledTimes(0)
    releaseSecond()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  test('does not let a lease release consume an anonymous pause owner', () => {
    const { pause, resume, store } = temporalStore()
    pauseSceneHistory(store)
    const release = acquireSceneHistoryPause(store)

    release()
    release()
    expect(getSceneHistoryPauseDepth()).toBe(1)
    expect(resume).toHaveBeenCalledTimes(0)
    resumeSceneHistory(store)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(pause).toHaveBeenCalledTimes(1)
  })
})
