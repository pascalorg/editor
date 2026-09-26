import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ItemNode, LevelNode, WallNode } from '../schema'
import type { AnyNodeId } from '../schema/types'
import { beginSceneHistoryPauseSession, getSceneHistoryPauseDepth } from './history-control'
import useScene, { beginSceneHistoryDraft, clearSceneHistory } from './use-scene'

// `updateNodesAction` batches dirty-marking through requestAnimationFrame.
type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const level = LevelNode.parse({ id: 'level_history_drafts', level: 0 })
const wall = WallNode.parse({
  id: 'wall_history_drafts',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
})
const item = ItemNode.parse({
  id: 'item_history_drafts',
  parentId: level.id,
  asset: { id: 'box', name: 'Box', category: 'decor', thumbnail: '', src: '/box.glb' },
  position: [1, 0, 1],
})
const levelId = level.id as AnyNodeId
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
const node = (id: AnyNodeId) => useScene.getState().nodes[id]
const wallStart = () => (node(wallId) as WallNode).start
const levelChildren = () => (node(levelId) as LevelNode).children

describe('scene history drafts', () => {
  test("an adopted draft's own writes record nothing; a foreign write records it as it was", () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    useScene.getState().updateNode(itemId, { metadata: { isTransient: true } })
    useScene.getState().updateNode(itemId, { parentId: wall.id, position: [2, 1, 0] })
    expect(past()).toBe(0)

    useScene.getState().updateNode(wallId, { start: [0, 1] })
    expect(past()).toBe(1)
    const recorded = useScene.temporal.getState().pastStates[0]!.nodes!
    expect(recorded[itemId]).toEqual(item)

    const carried = node(itemId)
    useScene.temporal.getState().undo()
    expect(wallStart()).toEqual([0, 0])
    expect(node(itemId)).toBe(carried)
    end()
  })

  test('a created draft never reaches history and survives an undo', () => {
    useScene.getState().updateNode(wallId, { start: [0, 1] })
    const draft = ItemNode.parse({
      parentId: level.id,
      asset: item.asset,
      metadata: { isTransient: true },
    })
    const end = beginSceneHistoryDraft(draft.id as AnyNodeId, null)
    useScene.getState().createNode(draft, levelId)
    expect(past()).toBe(1)

    useScene.temporal.getState().undo()
    expect(wallStart()).toEqual([0, 0])
    expect(node(draft.id as AnyNodeId)).toBeDefined()
    expect(levelChildren()).toContain(draft.id)
    end()
  })

  test("the gesture's commitStep records the drop even while the draft is registered", () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    const drop = beginSceneHistoryPauseSession(useScene, { gesture: item.id })
    drop.commitStep(() => useScene.getState().updateNode(itemId, { position: [3, 0, 1] }))
    drop.end()
    expect(past()).toBe(1)
    end()
    useScene.temporal.getState().undo()
    expect((node(itemId) as ItemNode).position).toEqual([1, 0, 1])
  })

  test('clearing history drops an abandoned keyed session, so no co-owner can re-take it', () => {
    const abandoned = beginSceneHistoryPauseSession(useScene, { gesture: 'item_a' })
    const coOwner = beginSceneHistoryPauseSession(useScene, { gesture: 'item_a' })
    clearSceneHistory()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)

    coOwner.commitStep(() => useScene.getState().updateNode(itemId, { position: [2, 0, 1] }))
    coOwner.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect(past()).toBe(1)
    abandoned.end()
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })
})
