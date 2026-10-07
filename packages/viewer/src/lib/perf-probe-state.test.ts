import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import useViewer from '../store/use-viewer'
import { readPerfHistory, readPerfSelection } from './perf-probe-state'

// Scene writes schedule dirty flushes on rAF; bun's test runtime has none.
type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

function resetHistory() {
  resetSceneHistoryPauseDepth()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
}

// Other test files share this process's scene store: start and end with clean history.
beforeEach(resetHistory)
afterEach(resetHistory)

describe('readPerfHistory', () => {
  test('counts entries and reports refcounted pauses', () => {
    const before = readPerfHistory(useScene)
    expect(before).toMatchObject({ past: 0, future: 0, tracking: true, pauseDepth: 0 })

    pauseSceneHistory(useScene)
    expect(readPerfHistory(useScene)).toMatchObject({ tracking: false, pauseDepth: 1 })
    resumeSceneHistory(useScene)
    expect(readPerfHistory(useScene)).toMatchObject({ tracking: true, pauseDepth: 0 })
  })

  test('a direct temporal pause shows as not tracking with no refcounted owner', () => {
    useScene.temporal.getState().pause()
    expect(readPerfHistory(useScene)).toMatchObject({ tracking: false, pauseDepth: 0 })
  })
})

describe('readPerfHistory after tracked edits', () => {
  test('past grows with tracked writes, undo moves an entry to future, redo moves it back', () => {
    const building = BuildingNode.parse({ parentId: null, children: [] })
    useScene.setState({ nodes: { [building.id]: building }, rootNodeIds: [building.id] })
    clearSceneHistory()
    expect(readPerfHistory(useScene)).toMatchObject({ past: 0, future: 0 })

    const id = building.id as AnyNodeId
    useScene.getState().updateNode(id, { name: 'first' })
    useScene.getState().updateNode(id, { name: 'second' })
    expect(readPerfHistory(useScene)).toMatchObject({ past: 2, future: 0, tracking: true })

    useScene.temporal.getState().undo()
    expect(readPerfHistory(useScene)).toMatchObject({ past: 1, future: 1 })
    useScene.temporal.getState().undo()
    expect(readPerfHistory(useScene)).toMatchObject({ past: 0, future: 2 })
    useScene.temporal.getState().redo()
    expect(readPerfHistory(useScene)).toMatchObject({ past: 1, future: 1 })

    // A write while paused is not an entry.
    pauseSceneHistory(useScene)
    useScene.getState().updateNode(id, { name: 'paused' })
    resumeSceneHistory(useScene)
    expect(readPerfHistory(useScene)).toMatchObject({ past: 1, tracking: true, pauseDepth: 0 })
  })
})

describe('readPerfSelection', () => {
  test('returns a copy of the selection path', () => {
    useViewer.getState().setSelection({ levelId: 'level_a', selectedIds: ['wall_a'] })
    const selection = readPerfSelection(useViewer)
    expect(selection).toMatchObject({ levelId: 'level_a', selectedIds: ['wall_a'] })
    selection.selectedIds.push('wall_b')
    expect(useViewer.getState().selection.selectedIds).toEqual(['wall_a'])
  })
})
