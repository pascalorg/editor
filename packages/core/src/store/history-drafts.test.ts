import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ItemNode, LevelNode, WallNode } from '../schema'
import type { AnyNodeId } from '../schema/types'
import {
  beginSceneHistoryPauseSession,
  getSceneHistoryPauseDepth,
  type SceneCommit,
  subscribeSceneCommits,
} from './history-control'
import useScene, {
  applySceneSnapshot,
  beginSceneHistoryDraft,
  clearSceneHistory,
  runSceneHistoryDraftWrite,
  sceneHistoryDraftRevertUpdates,
} from './use-scene'

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
    runSceneHistoryDraftWrite(() => {
      useScene.getState().updateNode(itemId, { metadata: { isTransient: true } })
      useScene.getState().updateNode(itemId, { parentId: wall.id, position: [2, 1, 0] })
    })
    expect(past()).toBe(0)

    useScene.getState().updateNode(wallId, { start: [0, 1] })
    expect(past()).toBe(1)
    const recorded = useScene.temporal.getState().pastStates[0]!.nodes!
    expect(recorded[itemId]).toEqual(item)

    const carried = node(itemId)
    useScene.temporal.getState().undo()
    expect(wallStart()).toEqual([0, 0])
    expect(node(itemId)).toEqual(carried)
    expect((node(wallId) as WallNode).children).toContain(itemId)
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
  test("a foreign edit to a carried item's other fields is recorded, not masked", () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    runSceneHistoryDraftWrite(() => useScene.getState().updateNode(itemId, { position: [3, 0, 3] }))
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().updateNode(itemId, { name: 'Renamed by a collaborator' })
    stop()
    expect(past()).toBe(1)
    const current = commits.at(-1)!.current.nodes[itemId] as ItemNode
    expect(current.name).toBe('Renamed by a collaborator')
    // The carry's own field is still recorded as it was before the pickup.
    expect(current.position).toEqual([1, 0, 1])
    end()
  })

  test('a carried item whose original host is deleted mid-carry is never recorded under it', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [levelId]: { ...level, children: [wall.id] },
        [wallId]: { ...structuredClone(wall), children: [item.id] },
        [itemId]: { ...structuredClone(item), parentId: wall.id },
      },
    } as never)
    clearSceneHistory()
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    // The carry detaches the item to the level, then a collaborator deletes the wall.
    runSceneHistoryDraftWrite(() => useScene.getState().updateNode(itemId, { parentId: levelId }))
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().deleteNode(wallId)
    stop()
    const current = commits.at(-1)!.current.nodes
    expect(current[wallId]).toBeUndefined()
    expect(current[itemId]?.parentId).toBe(levelId)
    expect((current[levelId] as LevelNode).children).toContain(itemId)
    end()
  })

  test('a host snapshot cannot replace the scene while a draft is carried', () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    const snapshot = {
      nodes: useScene.getState().nodes,
      rootNodeIds: useScene.getState().rootNodeIds,
      collections: {},
      materials: {},
      installedPlugins: [],
    }
    expect(() => applySceneSnapshot(snapshot as never, { origin: 'host' })).toThrow()
    end()
    expect(() => applySceneSnapshot(snapshot as never, { origin: 'host' })).not.toThrow()
  })

  test('undoing a foreign rename mid-carry reverts only the rename and keeps redo', () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    runSceneHistoryDraftWrite(() => useScene.getState().updateNode(itemId, { position: [3, 0, 3] }))
    useScene.getState().updateNode(itemId, { name: 'Renamed by a collaborator' })
    expect(past()).toBe(1)

    useScene.temporal.getState().undo()
    expect((node(itemId) as ItemNode).name).toBe(item.name)
    expect((node(itemId) as ItemNode).position).toEqual([3, 0, 3])
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)

    useScene.temporal.getState().redo()
    expect((node(itemId) as ItemNode).name).toBe('Renamed by a collaborator')
    expect((node(itemId) as ItemNode).position).toEqual([3, 0, 3])
    end()
  })

  test('a foreign write to a field the carry wrote is its own step, not masked', () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    runSceneHistoryDraftWrite(() => useScene.getState().updateNode(itemId, { position: [3, 0, 3] }))
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().updateNode(itemId, { position: [5, 0, 5] })
    stop()
    expect(past()).toBe(1)
    expect((commits.at(-1)!.current.nodes[itemId] as ItemNode).position).toEqual([5, 0, 5])
    // The carry writing the field again owns it again, from the foreign value.
    runSceneHistoryDraftWrite(() => useScene.getState().updateNode(itemId, { position: [2, 0, 2] }))
    useScene.getState().updateNode(wallId, { start: [0, 1] })
    expect(
      (useScene.temporal.getState().pastStates[1]!.nodes![itemId] as ItemNode).position,
    ).toEqual([5, 0, 5])
    end()
  })

  test('revert updates cover only the fields the carry still holds', () => {
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    runSceneHistoryDraftWrite(() =>
      useScene.getState().updateNode(itemId, { position: [3, 0, 3], rotation: [0, 1, 0] }),
    )
    useScene.getState().updateNode(itemId, { name: 'Renamed', rotation: [0, 2, 0] })
    expect(sceneHistoryDraftRevertUpdates([itemId])).toEqual([
      { id: itemId, data: { position: [1, 0, 1] } },
    ])
    end()
  })

  test('a same-host surface move cancelled mid-carry never comes back on undo', () => {
    const shelfId = 'procedural-item_history_drafts' as AnyNodeId
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [levelId]: { ...level, children: [wall.id, shelfId] },
        [shelfId]: {
          id: shelfId,
          type: 'procedural-item',
          parentId: levelId,
          metadata: {},
          children: [itemId],
          attachments: { [itemId]: 'top' },
        } as unknown as ItemNode,
        [itemId]: { ...structuredClone(item), parentId: shelfId },
      },
    } as never)
    clearSceneHistory()
    const attachment = () =>
      (node(shelfId) as unknown as { attachments: Record<string, string> }).attachments[itemId]
    const end = beginSceneHistoryDraft(itemId, node(itemId)!)
    runSceneHistoryDraftWrite(() => {
      useScene.getState().updateNodes([
        { id: itemId, data: { position: [0, 0.5, 0] } },
        { id: shelfId, data: { attachments: { [itemId]: 'middle' } } as never },
      ])
    })
    useScene.getState().updateNode(wallId, { start: [0, 1] })
    // Cancel: the carry puts back what it holds, then ends.
    runSceneHistoryDraftWrite(() => {
      const updates = sceneHistoryDraftRevertUpdates([itemId])
      useScene.getState().updateNodes(updates as never)
    })
    end()
    expect(attachment()).toBe('top')
    useScene.temporal.getState().undo()
    expect(wallStart()).toEqual([0, 0])
    expect(attachment()).toBe('top')
    expect((node(itemId) as ItemNode).position).toEqual([1, 0, 1])
  })
})
