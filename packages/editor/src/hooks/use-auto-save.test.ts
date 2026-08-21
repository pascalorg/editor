import { describe, expect, test } from 'bun:test'
import {
  createStoredNodeCountTracker,
  decideExitFlush,
  isSuspiciousNodeDrop,
} from './use-auto-save'

describe('isSuspiciousNodeDrop', () => {
  test('blocks populated scenes from being flushed as empty skeletons', () => {
    expect(isSuspiciousNodeDrop(12, 0)).toBe(true)
    expect(isSuspiciousNodeDrop(12, 4)).toBe(true)
  })

  test('allows ordinary edits and intentionally empty starting scenes', () => {
    expect(isSuspiciousNodeDrop(12, 11)).toBe(false)
    expect(isSuspiciousNodeDrop(4, 0)).toBe(false)
  })
})

describe('createStoredNodeCountTracker', () => {
  test('adopts a loaded graph as the baseline the guard measures against', () => {
    // The hook mounts before the scene loads, so the tracker starts at the bare
    // scaffold and only learns the real size when the load lands. Without this,
    // every session's first save compares a populated graph against ~0 and the
    // guard is dead for exactly the write that can destroy the most work.
    const tracker = createStoredNodeCountTracker(0)
    tracker.trackLoadedGraph(42)

    expect(tracker.allowWrite(0)).toBe(false)
    expect(tracker.count).toBe(42)
  })

  test('keeps blocking after a blocked write instead of adopting the empty graph', () => {
    const tracker = createStoredNodeCountTracker(0)
    tracker.trackLoadedGraph(42)

    expect(tracker.allowWrite(0)).toBe(false)
    // A debounced retry must not be the thing that finally lets the wipe land.
    expect(tracker.allowWrite(0)).toBe(false)
  })

  test('lets ordinary edits through and advances the baseline', () => {
    const tracker = createStoredNodeCountTracker(0)
    tracker.trackLoadedGraph(12)

    expect(tracker.allowWrite(13)).toBe(true)
    expect(tracker.count).toBe(13)
    expect(tracker.allowWrite(5)).toBe(true)
    expect(tracker.count).toBe(5)
  })

  test('does not treat a deliberately empty new scene as suspicious', () => {
    const tracker = createStoredNodeCountTracker(0)
    tracker.trackLoadedGraph(4)

    expect(tracker.allowWrite(0)).toBe(true)
  })

  test('adopts a smaller loaded graph, so restoring an older version still saves', () => {
    // Loading a 3-node version over a 40-node one is not a deletion.
    const tracker = createStoredNodeCountTracker(0)
    tracker.trackLoadedGraph(40)
    tracker.trackLoadedGraph(3)

    expect(tracker.allowWrite(3)).toBe(true)
  })
})

describe('decideExitFlush', () => {
  test('reproduces the 2026-08-16 scene-wipe sequence and skips the flush', () => {
    // The exact traced wipe (dev repro, scenes a4993ec9f1ab/1befee38f973 and
    // the live sessions of 2026-08-18):
    //  1. useAutoSave subscribes; store = initial empty state.
    //  2. useHostPanels' mount effect writes default installedPlugins — a
    //     scene-store change BEFORE the Editor's load effect runs, so the
    //     session is marked dirty with zero user edits.
    //  3. The load effect sets loading=true and calls unloadScene(); the
    //     tracker re-baselines to the transient 0-node state.
    //  4. StrictMode's simulated unmount (prod: tab close / navigation)
    //     runs the effect cleanup -> flushOnExit with an EMPTY store.
    // The flush must be skipped: the store content is transient, not data.
    expect(
      decideExitFlush({
        isLoadingScene: true,
        hasDirtyChanges: true,
        storedNodeCount: 0,
        currentNodeCount: 0,
      }),
    ).toBe('skip-loading')
  })

  test('never flushes while a load is in flight, whatever the counts say', () => {
    expect(
      decideExitFlush({
        isLoadingScene: true,
        hasDirtyChanges: true,
        storedNodeCount: 74,
        currentNodeCount: 74,
      }),
    ).toBe('skip-loading')
  })

  test('does nothing when there are no dirty changes', () => {
    expect(
      decideExitFlush({
        isLoadingScene: false,
        hasDirtyChanges: false,
        storedNodeCount: 74,
        currentNodeCount: 0,
      }),
    ).toBe('skip-clean')
  })

  test('blocks a populated-to-scaffold drop after hydration', () => {
    expect(
      decideExitFlush({
        isLoadingScene: false,
        hasDirtyChanges: true,
        storedNodeCount: 74,
        currentNodeCount: 0,
      }),
    ).toBe('blocked-suspicious')
  })

  test('flushes ordinary dirty sessions on exit', () => {
    expect(
      decideExitFlush({
        isLoadingScene: false,
        hasDirtyChanges: true,
        storedNodeCount: 74,
        currentNodeCount: 75,
      }),
    ).toBe('flush')
  })
})
