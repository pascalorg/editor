import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { BuildingNode } from '../schema/nodes/building'
import { LevelNode } from '../schema/nodes/level'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  areSceneHistorySnapshotsEqual,
  pauseSceneHistory,
  resumeSceneHistory,
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  type SceneHistorySnapshot,
  subscribeSceneCommits,
} from './history-control'
import useLiveNodeOverrides from './use-live-node-overrides'
import useLiveTransforms from './use-live-transforms'
import useScene, {
  acquireSceneReadOnlyLease,
  applyAcceptedSceneNodeUpdates,
  applySceneHistorySnapshot,
  clearSceneHistory,
} from './use-scene'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const BUILDING_ID = 'building_commit' as AnyNodeId
const LEVEL_ID = 'level_commit' as AnyNodeId

let unsubscribe = () => {}

function resetScene(): void {
  const level = LevelNode.parse({
    id: LEVEL_ID,
    parentId: BUILDING_ID,
    children: [],
    level: 0,
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    parentId: null,
    children: [LEVEL_ID],
  })
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
}

function levelNumber(): number {
  return (useScene.getState().nodes[LEVEL_ID] as { level: number }).level
}

function currentSnapshot(): SceneHistorySnapshot {
  const { nodes, rootNodeIds, collections, materials } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials }
}

describe('scene commit boundary', () => {
  beforeEach(() => {
    unsubscribe()
    unsubscribe = () => {}
    resetScene()
  })

  afterEach(() => {
    unsubscribe()
    unsubscribe = () => {}
  })

  test('emits one local commit with before/current snapshots and skips semantic no-ops', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
    expect(commits).toHaveLength(1)
    expect(commits[0]?.origin).toBe('local')
    expect((commits[0]?.before.nodes[LEVEL_ID] as { level: number }).level).toBe(0)
    expect((commits[0]?.current.nodes[LEVEL_ID] as { level: number }).level).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
    expect(commits).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('coalesces a compound transaction into one commit and one undo step', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
      useScene.getState().updateNode(LEVEL_ID, { level: 2 } as Partial<AnyNode>)
    })

    expect(commits).toHaveLength(1)
    expect((commits[0]?.before.nodes[LEVEL_ID] as { level: number }).level).toBe(0)
    expect((commits[0]?.current.nodes[LEVEL_ID] as { level: number }).level).toBe(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(levelNumber()).toBe(0)
  })

  test('drops a compound transaction that returns to its semantic baseline', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
      useScene.getState().updateNode(LEVEL_ID, { level: 0 } as Partial<AnyNode>)
    })

    expect(commits).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('applies accepted remote updates without local history and marks node and parent dirty', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    useLiveNodeOverrides.getState().set(LEVEL_ID, { level: 99 })
    useLiveTransforms.getState().set(LEVEL_ID, { position: [1, 0, 1], rotation: 0 })

    expect(
      applyAcceptedSceneNodeUpdates([{ id: LEVEL_ID, data: { level: 3 } as Partial<AnyNode> }]),
    ).toBe(true)

    expect(levelNumber()).toBe(3)
    expect(commits.map((commit) => commit.origin)).toEqual(['remote'])
    expect(commits.filter((commit) => commit.origin === 'local')).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.getState().dirtyNodes.has(LEVEL_ID)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(BUILDING_ID)).toBe(true)
    expect(useLiveNodeOverrides.getState().get(LEVEL_ID)).toBeUndefined()
    expect(useLiveTransforms.getState().get(LEVEL_ID)).toBeUndefined()
  })

  test('keeps accepted remote updates untracked across nested history pauses', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    const unsubscribeNestedPause = useScene.subscribe((state, previousState) => {
      if (state.nodes === previousState.nodes) return
      pauseSceneHistory(useScene)
      resumeSceneHistory(useScene)
    })

    try {
      expect(
        applyAcceptedSceneNodeUpdates([{ id: LEVEL_ID, data: { level: 3 } as Partial<AnyNode> }]),
      ).toBe(true)
    } finally {
      unsubscribeNestedPause()
    }

    expect(levelNumber()).toBe(3)
    expect(commits.map((commit) => commit.origin)).toEqual(['remote'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('applies accepted remote updates through read-only and restores the UI lock', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().setReadOnly(true)
    const beforeState = useScene.getState()
    const levelBefore = beforeState.nodes[LEVEL_ID]
    const buildingBefore = beforeState.nodes[BUILDING_ID]

    expect(
      applyAcceptedSceneNodeUpdates([{ id: LEVEL_ID, data: { level: 3 } as Partial<AnyNode> }]),
    ).toBe(true)

    expect(levelNumber()).toBe(3)
    expect(useScene.getState().readOnly).toBe(true)
    expect(commits.map((commit) => commit.origin)).toEqual(['remote'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.getState().nodes[LEVEL_ID]).toEqual({
      ...levelBefore,
      level: 3,
    } as AnyNode)
    expect(useScene.getState().nodes[BUILDING_ID]).toBe(buildingBefore)
    expect(useScene.getState().rootNodeIds).toBe(beforeState.rootNodeIds)
    expect(useScene.getState().collections).toBe(beforeState.collections)
    expect(useScene.getState().materials).toBe(beforeState.materials)

    useScene.getState().updateNode(LEVEL_ID, { level: 4 } as Partial<AnyNode>)
    expect(levelNumber()).toBe(3)
  })

  test('keeps read-only active until every owner releases its lease', () => {
    const releaseCollaboration = acquireSceneReadOnlyLease()
    const releasePreview = acquireSceneReadOnlyLease()

    expect(useScene.getState().readOnly).toBe(true)
    releaseCollaboration()
    expect(useScene.getState().readOnly).toBe(true)
    releaseCollaboration()
    expect(useScene.getState().readOnly).toBe(true)
    releasePreview()
    expect(useScene.getState().readOnly).toBe(false)
  })

  test('restores read-only and history tracking when an accepted update throws', () => {
    const throwingData = {} as Partial<AnyNode>
    Object.defineProperty(throwingData, 'level', {
      enumerable: true,
      get: () => {
        throw new Error('update failed')
      },
    })
    useScene.getState().setReadOnly(true)

    expect(() => applyAcceptedSceneNodeUpdates([{ id: LEVEL_ID, data: throwingData }])).toThrow(
      'update failed',
    )

    expect(levelNumber()).toBe(0)
    expect(useScene.getState().readOnly).toBe(true)
    expect(useScene.temporal.getState().isTracking).toBe(true)
  })

  test('rejects a remote update batch atomically when any target is missing', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(
      applyAcceptedSceneNodeUpdates([
        { id: LEVEL_ID, data: { level: 4 } as Partial<AnyNode> },
        { id: 'level_missing' as AnyNodeId, data: { level: 5 } as Partial<AnyNode> },
      ]),
    ).toBe(false)

    expect(levelNumber()).toBe(0)
    expect(commits).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('rejects accepted updates that would change a node identity', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(
      applyAcceptedSceneNodeUpdates([
        {
          id: LEVEL_ID,
          data: { id: 'level_rekeyed', level: 6 } as Partial<AnyNode>,
        },
      ]),
    ).toBe(false)

    expect(levelNumber()).toBe(0)
    expect(useScene.getState().nodes[LEVEL_ID]?.id).toBe(LEVEL_ID)
    expect(commits).toHaveLength(0)
  })

  test('defers accepted remote updates while a local interaction has history paused', () => {
    pauseSceneHistory(useScene)
    try {
      expect(
        applyAcceptedSceneNodeUpdates([{ id: LEVEL_ID, data: { level: 7 } as Partial<AnyNode> }]),
      ).toBe(false)
      expect(levelNumber()).toBe(0)
      expect(useScene.temporal.getState().isTracking).toBe(false)
    } finally {
      resumeSceneHistory(useScene)
    }
  })

  test('applies an authoritative snapshot as a history floor and clears live state', () => {
    useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useLiveNodeOverrides.getState().set(LEVEL_ID, { level: 99 })
    useLiveTransforms.getState().set(LEVEL_ID, { position: [1, 0, 1], rotation: 0 })

    const snapshot = currentSnapshot()
    snapshot.nodes = {
      ...snapshot.nodes,
      [LEVEL_ID]: { ...snapshot.nodes[LEVEL_ID], level: 8 } as AnyNode,
    }
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().dirtyNodes.clear()

    expect(applySceneHistorySnapshot(snapshot, { origin: 'reconciliation' })).toBe(true)
    expect(levelNumber()).toBe(8)
    expect(commits.map((commit) => commit.origin)).toEqual(['reconciliation'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(0)
    expect(useScene.getState().dirtyNodes.has(LEVEL_ID)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(BUILDING_ID)).toBe(true)
    expect(useLiveNodeOverrides.getState().get(LEVEL_ID)).toBeUndefined()
    expect(useLiveTransforms.getState().get(LEVEL_ID)).toBeUndefined()
  })

  test('rejects authoritative snapshot replacement during a paused interaction', () => {
    const snapshot = currentSnapshot()
    snapshot.nodes = {
      ...snapshot.nodes,
      [LEVEL_ID]: { ...snapshot.nodes[LEVEL_ID], level: 9 } as AnyNode,
    }

    pauseSceneHistory(useScene)
    try {
      expect(() => applySceneHistorySnapshot(snapshot, { origin: 'remote' })).toThrow(
        'active interaction',
      )
      expect(levelNumber()).toBe(0)
      expect(useScene.temporal.getState().isTracking).toBe(false)
    } finally {
      resumeSceneHistory(useScene)
    }
  })

  test('isolates a throwing listener so later listeners and Zundo still run', () => {
    const originalConsoleError = console.error
    const errorLog = mock(() => {})
    console.error = errorLog
    const stopThrowing = subscribeSceneCommits(() => {
      throw new Error('listener failed')
    })
    const healthyListener = mock(() => {})
    unsubscribe = subscribeSceneCommits(healthyListener)

    try {
      useScene.getState().updateNode(LEVEL_ID, { level: 2 } as Partial<AnyNode>)
      expect(healthyListener).toHaveBeenCalledTimes(1)
      expect(errorLog).toHaveBeenCalledTimes(1)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    } finally {
      stopThrowing()
      console.error = originalConsoleError
    }
  })

  test('semantic equality short-circuits shared nodes in a large scene', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {}
    for (let index = 0; index < 1_000; index += 1) {
      const id = `level_${index}` as AnyNodeId
      nodes[id] = { id, type: 'level', level: index, children: [] } as unknown as AnyNode
    }
    const left: SceneHistorySnapshot = {
      nodes,
      rootNodeIds: [],
      collections: {},
      materials: {},
    }
    const right: SceneHistorySnapshot = {
      ...left,
      nodes: { ...nodes, level_999: { ...nodes.level_999 } as AnyNode },
    }

    expect(areSceneHistorySnapshotsEqual(left, right)).toBe(true)
  })
})
