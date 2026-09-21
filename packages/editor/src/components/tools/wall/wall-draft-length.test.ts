import { afterEach, describe, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { constrainDraftPointToLength } from '../../../lib/draft-length'
import { useDraftLength } from '../../../store/use-draft-length'
import { createWallOnCurrentLevel } from './wall-drafting'

afterEach(() => useDraftLength.getState().clear())

describe('wall draft length', () => {
  test('keeps an exact length while direction changes without inventing a direction', () => {
    expect(constrainDraftPointToLength([1, 1], [1, 1], 3)).toEqual([1, 1])
    expect(constrainDraftPointToLength([2, 3], [5, 7], 2.5)).toEqual([3.5, 5])
    expect(constrainDraftPointToLength([2, 3], [-8, 3], 1.25)).toEqual([0.75, 3])
  })

  test('stores only finite lengths of at least one centimetre', () => {
    const draft = useDraftLength.getState()
    draft.setLength(3)
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.001]) {
      draft.setLength(invalid)
      expect(useDraftLength.getState().length).toBe(3)
    }
    draft.clear()
    expect(useDraftLength.getState().length).toBeNull()
  })

  test('commits the preview length near a wall without shortening it, as one undo step', () => {
    const initialScene = useScene.getState()
    const initialSelection = useViewer.getState().selection
    const level = LevelNode.parse({ id: 'level_length', children: ['wall_nearby'] })
    const nearby = WallNode.parse({
      id: 'wall_nearby',
      parentId: level.id,
      start: [3.78, -1],
      end: [3.78, 1],
    })
    try {
      useScene.setState({
        nodes: { [level.id]: level, [nearby.id]: nearby },
        rootNodeIds: [level.id],
        dirtyNodes: new Set(),
      })
      useViewer.setState({ selection: { ...initialSelection, levelId: level.id } })
      useScene.temporal.getState().clear()
      useScene.temporal.getState().resume()
      const before = useScene.getState().nodes
      useDraftLength.getState().setLength(3.75)
      const previewEnd = constrainDraftPointToLength([0, 0], [3.78, 0], 3.75)
      expect(useScene.getState().nodes).toBe(before)
      const wall = createWallOnCurrentLevel([0, 0], [3.78, 0])
      expect(wall?.end).toEqual(previewEnd!)
      expect(wall?.end[0]).toBe(3.75)
      expect(useScene.getState().nodes[nearby.id]).toBe(nearby)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(before)
    } finally {
      useScene.setState(initialScene)
      useViewer.setState({ selection: initialSelection })
      useScene.temporal.getState().clear()
    }
  })
})
