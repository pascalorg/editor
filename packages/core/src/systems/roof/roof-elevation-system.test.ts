import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { initSpatialGridSync } from '../../hooks/spatial-grid/spatial-grid-sync'
import { type AnyNode, type AnyNodeId, LevelNode, RoofNode, SlabNode, WallNode } from '../../schema'
import {
  pauseSceneHistory,
  resumeSceneHistory,
  type SceneCommit,
  subscribeSceneCommits,
} from '../../store/history-control'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { initializeRoofElevationSync } from './roof-elevation-system'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const originalState = useScene.getState()
let stopRoofSync = () => {}
let stopGridSync = () => {}
let stopCommitSubscription = () => {}

beforeEach(() => {
  spatialGridManager.clear()
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set<AnyNodeId>(),
    readOnly: false,
  })
  clearSceneHistory()
})

afterEach(() => {
  stopRoofSync()
  stopGridSync()
  stopCommitSubscription()
  spatialGridManager.clear()
  useScene.setState(originalState)
  clearSceneHistory()
})

function setup() {
  const level = LevelNode.parse({ height: 2.5 })
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0], height: 3 })
  const roof = RoofNode.parse({
    parentId: level.id,
    sourceWallIds: [wall.id],
    position: [2, 3, 1],
    rotation: 0.4,
  })
  const manual = RoofNode.parse({ parentId: level.id, position: [6, 7, 8] })
  level.children = [wall.id, roof.id, manual.id]
  useScene.setState({
    nodes: Object.fromEntries([level, wall, roof, manual].map((node) => [node.id, node])) as Record<
      AnyNodeId,
      AnyNode
    >,
    rootNodeIds: [level.id],
  })
  clearSceneHistory()
  stopRoofSync = initializeRoofElevationSync()
  stopGridSync = initSpatialGridSync()
  return { level, wall, roof, manual }
}

function currentRoof(id: RoofNode['id']): RoofNode {
  return useScene.getState().nodes[id] as RoofNode
}

describe('RoofElevationSystem', () => {
  test('a wall height edit moves the roof after one microtask without adding an undo step', async () => {
    const { wall, roof, manual } = setup()
    await Promise.resolve()
    const commits: SceneCommit[] = []
    stopCommitSubscription = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().updateNode(wall.id, { height: 4.2 })
    expect(currentRoof(roof.id).position).toEqual([2, 3, 1])
    await Promise.resolve()
    expect(currentRoof(roof.id).position).toEqual([2, 4.2, 1])
    expect(currentRoof(roof.id).rotation).toBe(0.4)
    expect(currentRoof(manual.id).position).toEqual([6, 7, 8])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(commits).toHaveLength(2)
    expect((commits[1]?.before.nodes[roof.id] as RoofNode).position[1]).toBe(3)
    expect((commits[1]?.current.nodes[roof.id] as RoofNode).position[1]).toBe(4.2)
    expect(commits[1]?.changedNodeIds).toEqual(new Set([roof.id]))
    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(3)
    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(4.2)
  })

  test('does not publish previews owned by an outer history pause', async () => {
    const { wall, roof } = setup()
    await Promise.resolve()
    const commits: SceneCommit[] = []
    stopCommitSubscription = subscribeSceneCommits((commit) => commits.push(commit))
    pauseSceneHistory(useScene)
    try {
      useScene.getState().updateNode(wall.id, { height: 4 })
      await Promise.resolve()
      expect(currentRoof(roof.id).position[1]).toBe(4)
      expect(useScene.temporal.getState().isTracking).toBe(false)
      expect(commits).toHaveLength(0)
    } finally {
      resumeSceneHistory(useScene)
    }
  })

  test('waits for the slab grid listener and tracks subsequent slab elevation edits', async () => {
    const { level, roof } = setup()
    const slab = SlabNode.parse({
      elevation: 0.5,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 2],
        [-1, 2],
      ],
    })
    useScene.getState().createNode(slab, level.id)
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(3.5)
    useScene.getState().updateNode(slab.id, { elevation: 0.9 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(3.9)
  })

  test('keeps a manual Y edit after its wall binding is removed', async () => {
    const { wall, roof } = setup()
    await Promise.resolve()
    useScene.getState().updateNode(roof.id, { sourceWallIds: undefined, position: [2, 9, 1] })
    useScene.getState().updateNode(wall.id, { height: 5 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(9)
    expect(currentRoof(roof.id)).not.toHaveProperty('sourceWallIds')
  })

  test('coalesces rapid edits, ignores epsilon drift and cancels queued work on disposal', async () => {
    const { wall, roof } = setup()
    await Promise.resolve()
    useScene.getState().updateNode(wall.id, { height: 3.00001 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(3)
    useScene.getState().updateNode(wall.id, { height: 4 })
    useScene.getState().updateNode(wall.id, { height: 5 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(5)
    useScene.getState().updateNode(wall.id, { height: 6 })
    stopRoofSync()
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(5)
  })
})
