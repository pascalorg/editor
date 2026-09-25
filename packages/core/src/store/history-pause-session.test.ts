import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ItemNode, LevelNode, WallNode } from '../schema'
import type { AnyNodeId } from '../schema/types'
import {
  beginSceneHistoryPauseSession,
  getSceneHistoryPauseDepth,
  subscribeSceneCommits,
} from './history-control'
import useScene, { applyScenePatch, clearSceneHistory, sceneHistorySnapshot } from './use-scene'

// `updateNodesAction` batches dirty-marking through requestAnimationFrame.
type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const level = LevelNode.parse({ id: 'level_pause_session', level: 0 })
const wall = WallNode.parse({
  id: 'wall_pause_session',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
})
const item = ItemNode.parse({
  id: 'item_pause_session',
  parentId: level.id,
  asset: { id: 'box', name: 'Box', category: 'decor', thumbnail: '', src: '/box.glb' },
  position: [1, 0, 1],
})
const wallId = wall.id as AnyNodeId
const itemId = item.id as AnyNodeId

let saved: ReturnType<typeof useScene.getState>
beforeEach(() => {
  saved = useScene.getState()
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [wall.id, item.id] },
      [wall.id]: structuredClone(wall),
      [item.id]: structuredClone(item),
    },
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    installedPlugins: [],
    dirtyNodes: new Set(),
    readOnly: false,
  } as never)
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(saved, true)
  clearSceneHistory()
})

const past = () => useScene.temporal.getState().pastStates.length
const wallStart = () => (useScene.getState().nodes[wallId] as WallNode).start
const itemX = () => (useScene.getState().nodes[itemId] as ItemNode).position[0]
const session = (gesture?: string) =>
  beginSceneHistoryPauseSession(useScene, {
    gesture,
    foreignWrites: { store: useScene, snapshot: sceneHistorySnapshot, ownNodeIds: () => [itemId] },
  })
/** The gesture's own drop: restore the baseline while paused, then the one tracked write. */
const drop = (x: number) => {
  useScene.getState().updateNode(itemId, { position: [x, 0, 1] })
}

describe('scene history pause session with foreign writes', () => {
  test('a local write during the gesture is its own step, before the gesture step', () => {
    const gesture = session()
    useScene.getState().updateNode(wallId, { start: [0, 1] })
    gesture.commitStep(() => drop(3))
    gesture.end()

    expect(past()).toBe(2)
    useScene.temporal.getState().undo()
    expect(itemX()).toBe(1)
    expect(wallStart()).toEqual([0, 1])
    useScene.temporal.getState().undo()
    expect(wallStart()).toEqual([0, 0])
  })

  test("the gesture's own writes are never a foreign step, even if its commit restores them imperfectly", () => {
    const gesture = session()
    useScene.getState().updateNode(itemId, { position: [2, 0, 1], name: 'carried' })
    gesture.commitStep(() => drop(3))
    gesture.end()
    expect(past()).toBe(1)

    const cancelled = session()
    useScene.getState().updateNode(itemId, { name: 'carried again' })
    cancelled.end()
    expect(past()).toBe(1)
  })

  test('a local write during a gesture that commits nothing is one step on end', () => {
    const commits: string[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit.origin))
    const gesture = session()
    useScene.getState().updateNode(wallId, { start: [0, 1] })
    gesture.end()
    stop()

    expect(past()).toBe(1)
    expect(commits).toEqual(['local'])
    useScene.temporal.getState().undo()
    expect(wallStart()).toEqual([0, 0])
  })

  test('a remote (host) change during the gesture never becomes a local step', () => {
    const gesture = session()
    applyScenePatch({
      materialChanges: [],
      nodeUpdates: [{ id: wallId, data: { start: [0, 2] }, removeFields: [] }],
    })
    gesture.commitStep(() => drop(3))
    gesture.end()
    expect(past()).toBe(1)
    useScene.temporal.getState().undo()
    expect(itemX()).toBe(1)
    expect(wallStart()).toEqual([0, 2])

    const cancelled = session()
    applyScenePatch({
      materialChanges: [],
      nodeUpdates: [{ id: wallId, data: { start: [0, 3] }, removeFields: [] }],
    })
    cancelled.end()
    expect(past()).toBe(0)
  })

  test('clearing history drops an abandoned keyed session, so no co-owner can re-take it', () => {
    const abandoned = beginSceneHistoryPauseSession(useScene, { gesture: 'item_a' })
    const coOwner = beginSceneHistoryPauseSession(useScene, { gesture: 'item_a' })
    clearSceneHistory()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)

    coOwner.commitStep(() => drop(2))
    coOwner.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect(past()).toBe(1)
    abandoned.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })
})
