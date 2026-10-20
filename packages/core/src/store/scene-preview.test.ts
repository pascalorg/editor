import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BuildingNode } from '../schema/nodes/building'
import { ItemNode } from '../schema/nodes/item'
import { LevelNode } from '../schema/nodes/level'
import { WallNode } from '../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  acquireSceneCommitAuthor,
  runAsSceneCommitAuthor,
  type SceneCommit,
  type SceneSnapshot,
  subscribeSceneCommits,
} from './history-control'
import {
  beginScenePreview,
  endScenePreview,
  isScenePreviewing,
  subscribeScenePreview,
} from './scene-preview'
import useLiveNodeOverrides from './use-live-node-overrides'
import useLiveTransforms from './use-live-transforms'
import useScene, { applySceneOperationPatch, clearSceneHistory } from './use-scene'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

// A preview is the scene as it was before an agent's turn, held under the person's finger and let go
// of again. Written first: a preview that leaves a trace in history, a commit, the saves or the
// agent's view; one that survives a write it would have swallowed; a release that does not give back
// the very scene that was there.

const BUILDING_ID = 'building_preview' as AnyNodeId
const LEVEL_ID = 'level_preview' as AnyNodeId
const ITEM_ID = 'item_preview' as AnyNodeId
const WALL_ID = 'wall_preview' as AnyNodeId
const OTHER_ID = 'item_untouched' as AnyNodeId

const asset = { id: 'chair', name: 'Chair', category: 'seating', thumbnail: '', src: '/chair.glb' }
let stopCommits = () => {}

function position(id: AnyNodeId): [number, number, number] {
  return (useScene.getState().nodes[id] as unknown as { position: [number, number, number] })
    .position
}

/** An agent turn: one wall built, one chair moved. Returns the scene as it stood before. */
function runTurn(): SceneSnapshot {
  const before = useScene.temporal.getState().pastStates.length
  const wall = WallNode.parse({ id: WALL_ID, parentId: LEVEL_ID, start: [0, 0], end: [4, 0] })
  runAsSceneCommitAuthor('agent', () => {
    useScene.getState().createNode(wall, LEVEL_ID)
    useScene.getState().updateNode(ITEM_ID, { position: [2, 0, 2] } as Partial<AnyNode>)
  })
  const past = useScene.temporal.getState().pastStates
  expect(past.length).toBeGreaterThan(before)
  return past[before] as SceneSnapshot
}

beforeEach(() => {
  const level = LevelNode.parse({ id: LEVEL_ID, parentId: BUILDING_ID, children: [], level: 0 })
  const building = BuildingNode.parse({ id: BUILDING_ID, parentId: null, children: [LEVEL_ID] })
  useScene.setState({
    nodes: { [BUILDING_ID]: building, [LEVEL_ID]: level },
    rootNodeIds: [BUILDING_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  for (const [id, at] of [
    [ITEM_ID, [1, 0, 1]],
    [OTHER_ID, [3, 0, 3]],
  ] as const) {
    useScene
      .getState()
      .createNode(ItemNode.parse({ id, parentId: LEVEL_ID, position: [...at], asset }), LEVEL_ID)
  }
  clearSceneHistory()
})

afterEach(() => {
  endScenePreview()
  stopCommits()
  stopCommits = () => {}
})

describe('beginScenePreview', () => {
  test('shows the scene as it was before the turn', () => {
    const before = runTurn()

    const preview = beginScenePreview(before)

    expect(preview).not.toBeNull()
    expect(useScene.getState().nodes[WALL_ID]).toBeUndefined()
    expect(position(ITEM_ID)).toEqual([1, 0, 1])
    expect(useScene.getState().nodes[OTHER_ID]).toBe(before.nodes[OTHER_ID])
    expect(isScenePreviewing()).toBe(true)
  })

  test('writes nothing: no history entry, no commit, the scene is read only', () => {
    const before = runTurn()
    const commits: SceneCommit[] = []
    stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
    const temporal = useScene.temporal.getState()
    const { pastStates, futureStates } = temporal
    const pastCopy = [...pastStates]

    const preview = beginScenePreview(before)

    expect(useScene.getState().readOnly).toBe(true)
    expect(useScene.temporal.getState().pastStates).toEqual(pastCopy)
    expect(useScene.temporal.getState().futureStates).toEqual(futureStates)
    useScene.getState().updateNode(ITEM_ID, { position: [9, 0, 9] } as Partial<AnyNode>)
    expect(position(ITEM_ID)).toEqual([1, 0, 1])
    preview?.end()
    expect(commits).toEqual([])
    expect(useScene.temporal.getState().pastStates).toEqual(pastCopy)
    expect(useScene.temporal.getState().futureStates).toEqual(futureStates)
  })

  test('refuses while history is held by a gesture, and while one preview is up', () => {
    const before = runTurn()
    useScene.temporal.getState().pause()
    expect(beginScenePreview(before)).toBeNull()
    useScene.temporal.getState().resume()

    const preview = beginScenePreview(before)
    expect(beginScenePreview(before)).toBeNull()
    preview?.end()
  })

  test('marks only what differs, and its parents, for a rebuild', () => {
    const before = runTurn()
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() } as never)

    beginScenePreview(before)

    const dirty = useScene.getState().dirtyNodes
    expect(dirty.has(ITEM_ID)).toBe(true)
    expect(dirty.has(LEVEL_ID)).toBe(true)
    expect(dirty.has(OTHER_ID)).toBe(false)
  })

  test('marks the neighbours of a wall that goes, which re-mitre', () => {
    const neighbour = WallNode.parse({
      id: 'wall_neighbour',
      parentId: LEVEL_ID,
      start: [4, 0],
      end: [4, 3],
    })
    useScene.getState().createNode(neighbour, LEVEL_ID)
    const before = runTurn()
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() } as never)

    beginScenePreview(before)

    expect(useScene.getState().dirtyNodes.has(neighbour.id)).toBe(true)
  })
})

describe('endScenePreview', () => {
  test('gives back the very scene that was there', () => {
    const before = runTurn()
    const held = useScene.getState()
    const nodes = held.nodes
    const preview = beginScenePreview(before)

    preview?.end()

    expect(useScene.getState().nodes).toBe(nodes)
    expect(useScene.getState().rootNodeIds).toBe(held.rootNodeIds)
    expect(useScene.getState().readOnly).toBe(false)
    expect(isScenePreviewing()).toBe(false)
    expect(position(ITEM_ID)).toEqual([2, 0, 2])
  })

  test('hands history back working: the next edit is one undoable step', () => {
    const before = runTurn()
    const steps = useScene.temporal.getState().pastStates.length
    beginScenePreview(before)?.end()

    useScene.getState().updateNode(ITEM_ID, { position: [5, 0, 5] } as Partial<AnyNode>)

    expect(useScene.temporal.getState().pastStates).toHaveLength(steps + 1)
    useScene.temporal.getState().undo()
    expect(position(ITEM_ID)).toEqual([2, 0, 2])
  })

  test('is safe to call twice, and with nothing to end', () => {
    const before = runTurn()
    const preview = beginScenePreview(before)
    preview?.end()
    preview?.end()
    endScenePreview()
    expect(useScene.getState().readOnly).toBe(false)
    expect(useScene.temporal.getState().isTracking).toBe(true)
  })

  test('tells whoever watches, once each way', () => {
    const seen: boolean[] = []
    const stop = subscribeScenePreview((previewing) => seen.push(previewing))
    const before = runTurn()

    beginScenePreview(before)?.end()

    stop()
    expect(seen).toEqual([true, false])
  })
})

describe('a write ends the preview first', () => {
  test('an agent writing', () => {
    const before = runTurn()
    beginScenePreview(before)

    runAsSceneCommitAuthor('agent', () => {
      expect(isScenePreviewing()).toBe(false)
      useScene.getState().updateNode(ITEM_ID, { position: [7, 0, 7] } as Partial<AnyNode>)
    })

    expect(position(ITEM_ID)).toEqual([7, 0, 7])
    expect(useScene.getState().nodes[WALL_ID]).toBeDefined()
  })

  test('an agent about to write across awaits', () => {
    const before = runTurn()
    beginScenePreview(before)

    const release = acquireSceneCommitAuthor('agent')

    expect(isScenePreviewing()).toBe(false)
    release()
  })

  test('a collaborator or the host patching the scene', () => {
    const before = runTurn()
    beginScenePreview(before)

    const applied = applySceneOperationPatch({
      materialChanges: [],
      nodeCreates: [],
      nodeDeletes: [],
      nodeUpdates: [
        { id: OTHER_ID, data: { position: [3.5, 0, 3.5] } as Partial<AnyNode>, removeFields: [] },
      ],
    })

    expect(applied).toBe(true)
    expect(isScenePreviewing()).toBe(false)
    expect(useScene.getState().nodes[WALL_ID]).toBeDefined()
    expect(position(OTHER_ID)).toEqual([3.5, 0, 3.5])
  })

  test('an undo, which acts on the real history and not on what is shown', () => {
    const before = runTurn()
    beginScenePreview(before)

    useScene.temporal.getState().undo(2)

    expect(isScenePreviewing()).toBe(false)
    expect(useScene.getState().nodes[WALL_ID]).toBeUndefined()
    expect(position(ITEM_ID)).toEqual([1, 0, 1])
    expect(useScene.getState().readOnly).toBe(false)
  })

  test('a redo', () => {
    const before = runTurn()
    useScene.temporal.getState().undo(1)
    beginScenePreview(before)
    expect(useScene.getState().nodes[WALL_ID]).toBeUndefined()

    useScene.temporal.getState().redo(1)

    expect(isScenePreviewing()).toBe(false)
    expect(useScene.getState().nodes[WALL_ID]).toBeDefined()
    expect(position(ITEM_ID)).toEqual([2, 0, 2])
  })
})
