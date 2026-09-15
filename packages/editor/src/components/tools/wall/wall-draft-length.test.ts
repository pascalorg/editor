import { afterEach, describe, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFloorplanDraftPreview } from '../../../store/use-floorplan-draft-preview'
import { createWallOnCurrentLevel } from './wall-drafting'

afterEach(() => useFloorplanDraftPreview.getState().reset())

describe('wall draft length', () => {
  test('Enter routes the exact preview endpoint to the active owner and synchronizes split view', () => {
    const draft = useFloorplanDraftPreview.getState()
    const calls: Array<{ view: string; end: number[] }> = []
    const unregister2D = draft.registerWallDraftCommit('2d', (end) => {
      calls.push({ view: '2d', end })
      return true
    })
    const unregister3D = draft.registerWallDraftCommit('3d', (end) => {
      calls.push({ view: '3d', end })
      return true
    })
    try {
      draft.setWallDraftStart([0, 0])
      draft.setWallDraftEnd([4, 0])
      draft.setWallDraftLength(3.75)
      expect(draft.commitWallDraft('2d')).toBe(true)
      expect(draft.commitWallDraft('3d')).toBe(true)
      expect(draft.commitWallDraft('split')).toBe(true)
      expect(calls).toEqual([
        { view: '2d', end: [3.75, 0] },
        { view: '3d', end: [3.75, 0] },
        { view: '3d', end: [3.75, 0] },
        { view: '2d', end: [3.75, 0] },
      ])
    } finally {
      unregister2D()
      unregister3D()
    }
    expect(draft.commitWallDraft('3d')).toBe(false)
  })

  test('Enter without a direction or length does not place a wall', () => {
    const draft = useFloorplanDraftPreview.getState()
    let commits = 0
    const unregister = draft.registerWallDraftCommit('2d', () => {
      commits++
      return true
    })
    try {
      draft.setWallDraftStart([0, 0])
      draft.setWallDraftEnd([0, 0])
      draft.setWallDraftLength(3)
      expect(draft.commitWallDraft('2d')).toBe(false)
      draft.setWallDraftEnd([4, 0])
      draft.setWallDraftLength(null)
      expect(draft.commitWallDraft('2d')).toBe(false)
      expect(commits).toBe(0)
    } finally {
      unregister()
    }
  })

  test('bare Enter places the current preview without requiring a typed length', () => {
    const draft = useFloorplanDraftPreview.getState()
    const ends: number[][] = []
    const unregister = draft.registerWallDraftCommit('2d', (end) => {
      ends.push(end)
      return true
    })
    try {
      draft.setWallDraftStart([1, 2])
      draft.setWallDraftEnd([1, 2])
      expect(draft.commitWallDraft('2d', true)).toBe(false)
      draft.setWallDraftEnd([5, 2])
      expect(draft.commitWallDraft('2d', true)).toBe(true)
      expect(ends).toEqual([[5, 2]])
    } finally {
      unregister()
    }
  })

  test('updates the preview immediately and keeps length while changing direction', () => {
    const draft = useFloorplanDraftPreview.getState()
    draft.setWallDraftStart([2, 3])
    draft.setWallDraftEnd([5, 7])
    draft.setWallDraftLength(2.5)
    expect(useFloorplanDraftPreview.getState().wallDraftEnd).toEqual([3.5, 5])
    draft.setWallDraftEnd([-8, 3])
    expect(useFloorplanDraftPreview.getState().wallDraftEnd).toEqual([-0.5, 3])
    draft.setWallDraftLength(1.25)
    expect(useFloorplanDraftPreview.getState().wallDraftEnd).toEqual([0.75, 3])
    draft.setWallDraftLength(null)
    expect(useFloorplanDraftPreview.getState().wallDraftEnd).toEqual([-8, 3])
  })

  test('clears the length for the next segment, but preserves it on repeated start publication', () => {
    const draft = useFloorplanDraftPreview.getState()
    draft.setWallDraftStart([0, 0])
    draft.setWallDraftLength(3)
    draft.setWallDraftStart([0, 0])
    expect(useFloorplanDraftPreview.getState().wallDraftLength).toBe(3)
    draft.setWallDraftStart([3, 0])
    expect(useFloorplanDraftPreview.getState().wallDraftLength).toBeNull()
    draft.setWallDraftLength(2)
    draft.setWallDraftStart(null)
    expect(useFloorplanDraftPreview.getState().wallDraftLength).toBeNull()
  })

  test('does not invent a direction at the start or accept invalid lengths', () => {
    const draft = useFloorplanDraftPreview.getState()
    draft.setWallDraftStart([1, 1])
    draft.setWallDraftEnd([1, 1])
    draft.setWallDraftLength(3)
    expect(useFloorplanDraftPreview.getState().wallDraftEnd).toEqual([1, 1])
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.001]) {
      draft.setWallDraftLength(invalid)
      expect(useFloorplanDraftPreview.getState().wallDraftLength).toBe(3)
    }
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
      const draft = useFloorplanDraftPreview.getState()
      draft.setWallDraftStart([0, 0])
      draft.setWallDraftEnd([3.78, 0])
      draft.setWallDraftLength(3.75)
      const previewEnd = useFloorplanDraftPreview.getState().wallDraftEnd
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
