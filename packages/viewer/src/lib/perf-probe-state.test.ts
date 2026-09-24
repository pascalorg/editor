import { afterEach, describe, expect, test } from 'bun:test'
import {
  pauseSceneHistory,
  resetSceneHistoryPauseDepth,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import useViewer from '../store/use-viewer'
import { readPerfHistory, readPerfSelection } from './perf-probe-state'

afterEach(() => {
  resetSceneHistoryPauseDepth()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})

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

describe('readPerfSelection', () => {
  test('returns a copy of the selection path', () => {
    useViewer.getState().setSelection({ levelId: 'level_a', selectedIds: ['wall_a'] })
    const selection = readPerfSelection(useViewer)
    expect(selection).toMatchObject({ levelId: 'level_a', selectedIds: ['wall_a'] })
    selection.selectedIds.push('wall_b')
    expect(useViewer.getState().selection.selectedIds).toEqual(['wall_a'])
  })
})
