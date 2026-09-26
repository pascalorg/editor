import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSceneHistoryPause,
  beginSceneHistoryPauseSession,
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

function trackingStore() {
  let tracking = true
  const pause = () => {
    tracking = false
  }
  const resume = () => {
    tracking = true
  }
  return {
    tracking: () => tracking,
    store: { temporal: { getState: () => ({ pause, resume }) } },
  }
}

describe('scene history pause session', () => {
  beforeEach(() => resetSceneHistoryPauseDepth())

  test('a balanced foreign pause pair cannot resume history under the session', () => {
    const { tracking, store } = trackingStore()
    const session = beginSceneHistoryPauseSession(store)

    pauseSceneHistory(store)
    resumeSceneHistory(store)
    expect(tracking()).toBe(false)
    expect(getSceneHistoryPauseDepth()).toBe(1)
    session.end()
    expect(tracking()).toBe(true)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  test('commitStep lifts only its own pause for the write, then takes it back', () => {
    const { tracking, store } = trackingStore()
    const session = beginSceneHistoryPauseSession(store)

    expect(session.commitStep(() => tracking())).toBe(true)
    expect(tracking()).toBe(false)
    expect(getSceneHistoryPauseDepth()).toBe(1)

    pauseSceneHistory(store)
    expect(session.commitStep(() => tracking())).toBe(false)
    expect(getSceneHistoryPauseDepth()).toBe(2)
    resumeSceneHistory(store)
    session.end()
    expect(tracking()).toBe(true)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  test('commitStep takes the pause back when the write throws', () => {
    const { tracking, store } = trackingStore()
    const session = beginSceneHistoryPauseSession(store)

    expect(() =>
      session.commitStep(() => {
        throw new Error('rejected')
      }),
    ).toThrow('rejected')
    expect(tracking()).toBe(false)
    expect(getSceneHistoryPauseDepth()).toBe(1)
    session.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  test('end is idempotent and releases only the session pause', () => {
    const { tracking, store } = trackingStore()
    pauseSceneHistory(store)
    const session = beginSceneHistoryPauseSession(store)

    session.end()
    session.end()
    expect(tracking()).toBe(false)
    expect(getSceneHistoryPauseDepth()).toBe(1)
    resumeSceneHistory(store)
    expect(tracking()).toBe(true)
  })

  test('nested commitStep, end inside commitStep and commitStep after end leak no pause', () => {
    const { tracking, store } = trackingStore()
    const session = beginSceneHistoryPauseSession(store)

    session.commitStep(() => session.commitStep(() => {}))
    expect(getSceneHistoryPauseDepth()).toBe(1)
    session.commitStep(() => session.end())
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(session.commitStep(() => tracking())).toBe(true)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(tracking()).toBe(true)
  })

  test("co-owners of one gesture lift together; other owners' pauses still hold", () => {
    const { tracking, store } = trackingStore()
    const overlay = beginSceneHistoryPauseSession(store, { gesture: 'item_a' })
    const mover = beginSceneHistoryPauseSession(store, { gesture: 'item_a' })
    const otherGesture = beginSceneHistoryPauseSession(store, { gesture: 'item_b' })

    expect(mover.commitStep(() => getSceneHistoryPauseDepth())).toBe(1)
    expect(getSceneHistoryPauseDepth()).toBe(3)
    otherGesture.end()
    expect(overlay.commitStep(() => tracking())).toBe(true)
    expect(getSceneHistoryPauseDepth()).toBe(2)

    mover.end()
    expect(overlay.commitStep(() => getSceneHistoryPauseDepth())).toBe(0)
    expect(overlay.commitStep(() => mover.commitStep(() => tracking()))).toBe(true)
    overlay.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(tracking()).toBe(true)
  })

  test('a co-owner that ends inside the other one commitStep is not taken back', () => {
    const { tracking, store } = trackingStore()
    const overlay = beginSceneHistoryPauseSession(store, { gesture: 'item_a' })
    const mover = beginSceneHistoryPauseSession(store, { gesture: 'item_a' })

    mover.commitStep(() => overlay.end())
    expect(getSceneHistoryPauseDepth()).toBe(1)
    mover.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(tracking()).toBe(true)
  })
})
