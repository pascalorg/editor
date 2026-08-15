import { describe, expect, test } from 'bun:test'
import {
  createStoredNodeCountTracker,
  isEmptyGraphWrite,
  isSuspiciousNodeDrop,
} from './use-auto-save'

describe('isEmptyGraphWrite', () => {
  // The drop guard cannot see this case: it is seeded from the store at mount,
  // which is empty mid-load, so the 0 → 0 write it is asked about looks like no
  // drop at all. That is exactly the write that wiped a stored scene, flushed
  // from the autosave effect's cleanup during React StrictMode's remount.
  test('refuses a graph with no nodes or no roots', () => {
    expect(isEmptyGraphWrite(0, 0)).toBe(true)
    expect(isEmptyGraphWrite(0, 1)).toBe(true)
    expect(isEmptyGraphWrite(20, 0)).toBe(true)
  })

  test('allows the smallest real document — the default scaffold', () => {
    expect(isEmptyGraphWrite(3, 1)).toBe(false)
  })
})

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
