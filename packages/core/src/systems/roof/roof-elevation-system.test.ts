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
  const level = LevelNode.parse({ height: 3, level: 0 })
  const upper = LevelNode.parse({ height: 3, level: 1 })
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0], height: 3 })
  const roof = RoofNode.parse({
    parentId: upper.id,
    support: { kind: 'walls' },
    position: [2, 0, 1],
    rotation: 0.4,
  })
  const manual = RoofNode.parse({ parentId: level.id, position: [6, 7, 8] })
  const otherWalls = [
    WallNode.parse({ parentId: level.id, start: [4, 0], end: [4, 3], height: 3 }),
    WallNode.parse({ parentId: level.id, start: [4, 3], end: [0, 3], height: 3 }),
    WallNode.parse({ parentId: level.id, start: [0, 3], end: [0, 0], height: 3 }),
  ]
  level.children = [wall.id, ...otherWalls.map((node) => node.id), manual.id]
  upper.children = [roof.id]
  useScene.setState({
    nodes: Object.fromEntries(
      [level, upper, wall, ...otherWalls, roof, manual].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [level.id, upper.id],
  })
  clearSceneHistory()
  stopRoofSync = initializeRoofElevationSync()
  stopGridSync = initSpatialGridSync()
  return { level, upper, wall, otherWalls, roof, manual }
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
    expect(currentRoof(roof.id).position).toEqual([2, 0, 1])
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBeCloseTo(1.2)
    expect(currentRoof(roof.id).rotation).toBe(0.4)
    expect(currentRoof(manual.id).position).toEqual([6, 7, 8])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(commits).toHaveLength(2)
    expect((commits[1]?.before.nodes[roof.id] as RoofNode).position[1]).toBe(0)
    expect((commits[1]?.current.nodes[roof.id] as RoofNode).position[1]).toBeCloseTo(1.2)
    expect(commits[1]?.changedNodeIds).toEqual(new Set([roof.id]))
    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(0)
    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBeCloseTo(1.2)
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
      expect(currentRoof(roof.id).position[1]).toBe(1)
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
    expect(currentRoof(roof.id).position[1]).toBe(0.5)
    useScene.getState().updateNode(slab.id, { elevation: 0.9 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBeCloseTo(0.9)
  })

  test('keeps a custom Y edit after follow mode is disabled', async () => {
    const { wall, roof } = setup()
    await Promise.resolve()
    useScene.getState().updateNode(roof.id, { support: { kind: 'level' }, position: [2, 9, 1] })
    useScene.getState().updateNode(wall.id, { height: 5 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(9)
    expect(currentRoof(roof.id).support).toEqual({ kind: 'level' })
  })

  test('undo and redo restore custom/follow mode and Y together', async () => {
    const { roof } = setup()
    await Promise.resolve()
    useScene.getState().updateNode(roof.id, { support: { kind: 'level' }, position: [2, 9, 1] })
    await Promise.resolve()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'walls' }, position: [2, 0, 1] })
    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'level' }, position: [2, 9, 1] })
    useScene.getState().updateNode(roof.id, { support: { kind: 'walls' } })
    expect(currentRoof(roof.id).position[1]).toBe(9)
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'walls' }, position: [2, 0, 1] })
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'level' }, position: [2, 9, 1] })
    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'walls' }, position: [2, 0, 1] })
  })

  test('deleting all walls freezes Y and redrawing an enclosure resumes following', async () => {
    const { level, wall, otherWalls, roof } = setup()
    useScene.getState().updateNode(wall.id, { height: 4 })
    await Promise.resolve()
    const walls = [wall, ...otherWalls]
    useScene.getState().deleteNodes(walls.map((node) => node.id))
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'walls' }, position: [2, 1, 1] })
    const replacements = walls.map((node) =>
      WallNode.parse({ ...node, id: undefined, height: 2.5 }),
    )
    useScene.getState().createNodes(replacements.map((node) => ({ node, parentId: level.id })))
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({
      support: { kind: 'walls' },
      position: [2, -0.5, 1],
    })
    useScene.temporal.getState().undo()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'walls' }, position: [2, 1, 1] })
    useScene.temporal.getState().redo()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({
      support: { kind: 'walls' },
      position: [2, -0.5, 1],
    })
  })

  test('an XZ-only move resolves a different enclosure without changing mode', async () => {
    const { level, wall, otherWalls, roof } = setup()
    const second = [wall, ...otherWalls].map((node) =>
      WallNode.parse({
        ...node,
        id: undefined,
        height: 5,
        start: [node.start[0] + 10, node.start[1]],
        end: [node.end[0] + 10, node.end[1]],
      }),
    )
    useScene.getState().createNodes(second.map((node) => ({ node, parentId: level.id })))
    await Promise.resolve()
    useScene.getState().updateNode(roof.id, { position: [12, 0, 1] })
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'walls' }, position: [12, 2, 1] })
  })

  test('initialization never changes existing custom roofs', async () => {
    const { roof } = setup()
    stopRoofSync()
    useScene.getState().updateNode(roof.id, { support: { kind: 'level' }, position: [2, 8, 1] })
    clearSceneHistory()
    stopRoofSync = initializeRoofElevationSync()
    await Promise.resolve()
    expect(currentRoof(roof.id)).toMatchObject({ support: { kind: 'level' }, position: [2, 8, 1] })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('coalesces rapid edits, ignores epsilon drift and cancels queued work on disposal', async () => {
    const { wall, roof } = setup()
    await Promise.resolve()
    useScene.getState().updateNode(wall.id, { height: 3.00001 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(0)
    useScene.getState().updateNode(wall.id, { height: 4 })
    useScene.getState().updateNode(wall.id, { height: 5 })
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(2)
    useScene.getState().updateNode(wall.id, { height: 6 })
    stopRoofSync()
    await Promise.resolve()
    expect(currentRoof(roof.id).position[1]).toBe(2)
  })
})
