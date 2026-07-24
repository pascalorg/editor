import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry } from '../registry/registry'
import type { AnyNodeDefinition } from '../registry/types'
import { BuildingNode } from '../schema/nodes/building'
import { LevelNode } from '../schema/nodes/level'
import { SceneMaterial, type SceneMaterialId } from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  areSceneSnapshotsEqual,
  pauseSceneHistory,
  resumeSceneHistory,
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  type SceneSnapshot,
  subscribeSceneCommits,
} from './history-control'
import useLiveNodeOverrides from './use-live-node-overrides'
import useLiveTransforms from './use-live-transforms'
import useScene, {
  acquireSceneReadOnlyLease,
  applySceneOperationPatch,
  applyScenePatch,
  applySceneSnapshot,
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

function currentSnapshot(): SceneSnapshot {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}

function applyHostNodePatches(
  nodeUpdates: Array<
    Omit<Parameters<typeof applyScenePatch>[0]['nodeUpdates'][number], 'removeFields'>
  >,
) {
  return applyScenePatch({
    materialChanges: [],
    nodeUpdates: nodeUpdates.map((update) => ({ ...update, removeFields: [] })),
  })
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

  test('applies host patches without local history and marks node and parent dirty', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(applyHostNodePatches([{ id: LEVEL_ID, data: { level: 3 } as Partial<AnyNode> }])).toBe(
      true,
    )

    expect(levelNumber()).toBe(3)
    expect(commits.map((commit) => commit.origin)).toEqual(['host'])
    expect(commits.filter((commit) => commit.origin === 'local')).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.getState().dirtyNodes.has(LEVEL_ID)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(BUILDING_ID)).toBe(true)
  })

  test('applies material patches atomically and dirties nodes that reference them', () => {
    const materialId = 'mat_host' as SceneMaterialId
    const material = SceneMaterial.parse({
      id: materialId,
      name: 'Host red',
      material: { properties: { color: '#ff0000' } },
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [LEVEL_ID]: {
          ...state.nodes[LEVEL_ID],
          slots: { surface: `scene:${materialId}` },
        } as AnyNode,
      },
    }))
    clearSceneHistory()
    useScene.getState().dirtyNodes.clear()
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(
      applyScenePatch({
        materialChanges: [{ id: materialId, material }],
        nodeUpdates: [],
      }),
    ).toBe(true)

    expect(useScene.getState().materials[materialId]).toEqual(material)
    expect(useScene.getState().dirtyNodes.has(LEVEL_ID)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(BUILDING_ID)).toBe(true)
    expect(commits.map((commit) => commit.origin)).toEqual(['host'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)

    expect(
      applyScenePatch({
        materialChanges: [{ id: materialId, material: null }],
        nodeUpdates: [{ id: LEVEL_ID, data: {}, removeFields: ['slots'] }],
      }),
    ).toBe(true)
    expect(useScene.getState().materials[materialId]).toBeUndefined()
    expect(useScene.getState().nodes[LEVEL_ID]).not.toHaveProperty('slots')
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('keeps host patches untracked across nested history pauses', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    const unsubscribeNestedPause = useScene.subscribe((state, previousState) => {
      if (state.nodes === previousState.nodes) return
      pauseSceneHistory(useScene)
      resumeSceneHistory(useScene)
    })

    try {
      expect(applyHostNodePatches([{ id: LEVEL_ID, data: { level: 3 } as Partial<AnyNode> }])).toBe(
        true,
      )
    } finally {
      unsubscribeNestedPause()
    }

    expect(levelNumber()).toBe(3)
    expect(commits.map((commit) => commit.origin)).toEqual(['host'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('applies host patches through read-only and restores the UI lock', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().setReadOnly(true)
    const beforeState = useScene.getState()
    const levelBefore = beforeState.nodes[LEVEL_ID]
    const buildingBefore = beforeState.nodes[BUILDING_ID]

    expect(applyHostNodePatches([{ id: LEVEL_ID, data: { level: 3 } as Partial<AnyNode> }])).toBe(
      true,
    )

    expect(levelNumber()).toBe(3)
    expect(useScene.getState().readOnly).toBe(true)
    expect(commits.map((commit) => commit.origin)).toEqual(['host'])
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
    const releaseHost = acquireSceneReadOnlyLease()
    const releasePreview = acquireSceneReadOnlyLease()

    expect(useScene.getState().readOnly).toBe(true)
    releaseHost()
    expect(useScene.getState().readOnly).toBe(true)
    releaseHost()
    expect(useScene.getState().readOnly).toBe(true)
    releasePreview()
    expect(useScene.getState().readOnly).toBe(false)
  })

  test('restores read-only and history tracking when a host patch throws', () => {
    const throwingData = {} as Partial<AnyNode>
    Object.defineProperty(throwingData, 'level', {
      enumerable: true,
      get: () => {
        throw new Error('update failed')
      },
    })
    useScene.getState().setReadOnly(true)

    expect(() => applyHostNodePatches([{ id: LEVEL_ID, data: throwingData }])).toThrow(
      'update failed',
    )

    expect(levelNumber()).toBe(0)
    expect(useScene.getState().readOnly).toBe(true)
    expect(useScene.temporal.getState().isTracking).toBe(true)
  })

  test('rejects a host patch atomically when any target is missing', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(
      applyHostNodePatches([
        { id: LEVEL_ID, data: { level: 4 } as Partial<AnyNode> },
        { id: 'level_missing' as AnyNodeId, data: { level: 5 } as Partial<AnyNode> },
      ]),
    ).toBe(false)

    expect(levelNumber()).toBe(0)
    expect(commits).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('rejects patches that would change a node identity', () => {
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(
      applyHostNodePatches([
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

  test('applies a disjoint host patch while a local interaction has history paused', () => {
    useLiveNodeOverrides.getState().set(BUILDING_ID, { visible: false })
    pauseSceneHistory(useScene)
    try {
      expect(applyHostNodePatches([{ id: LEVEL_ID, data: { level: 7 } as Partial<AnyNode> }])).toBe(
        true,
      )
      expect(levelNumber()).toBe(7)
      expect(useScene.temporal.getState().isTracking).toBe(false)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useLiveNodeOverrides.getState().get(BUILDING_ID)).toEqual({ visible: false })
    } finally {
      resumeSceneHistory(useScene)
    }
  })

  test('defers a host patch that collides with a live node or structural parent', () => {
    pauseSceneHistory(useScene)
    try {
      useLiveNodeOverrides.getState().set(LEVEL_ID, { level: 9 })
      expect(applyHostNodePatches([{ id: LEVEL_ID, data: { level: 7 } as Partial<AnyNode> }])).toBe(
        false,
      )
      expect(levelNumber()).toBe(0)
      expect(useLiveNodeOverrides.getState().get(LEVEL_ID)).toEqual({ level: 9 })

      useLiveNodeOverrides.getState().clear(LEVEL_ID)
      useLiveTransforms.getState().set(LEVEL_ID, { position: [1, 0, 1], rotation: 0 })
      expect(applyHostNodePatches([{ id: LEVEL_ID, data: { level: 7 } as Partial<AnyNode> }])).toBe(
        false,
      )
      expect(useLiveTransforms.getState().get(LEVEL_ID)).toEqual({
        position: [1, 0, 1],
        rotation: 0,
      })

      useLiveTransforms.getState().clear(LEVEL_ID)
      useLiveNodeOverrides.getState().set(BUILDING_ID, { visible: false })
      const child = LevelNode.parse({
        id: 'level_live_parent',
        parentId: BUILDING_ID,
        children: [],
        level: 1,
      })
      expect(
        applySceneOperationPatch({
          materialChanges: [],
          nodeCreates: [{ node: child, position: 1 }],
          nodeDeletes: [],
          nodeUpdates: [],
        }),
      ).toBe(false)
      expect(useScene.getState().nodes[child.id]).toBeUndefined()
      expect(useLiveNodeOverrides.getState().get(BUILDING_ID)).toEqual({ visible: false })

      const existingChild = useScene.getState().nodes[LEVEL_ID] as AnyNode
      expect(
        applySceneOperationPatch({
          materialChanges: [],
          nodeCreates: [],
          nodeDeletes: [{ node: existingChild, position: 0 }],
          nodeUpdates: [],
        }),
      ).toBe(false)
      expect(useScene.getState().nodes[LEVEL_ID]).toBe(existingChild)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    } finally {
      resumeSceneHistory(useScene)
    }
  })

  test('validates registered creates and updates without stripping forward-compatible fields', () => {
    const kind = 'test:operation-forward-compatible'
    if (!nodeRegistry.has(kind)) {
      nodeRegistry._register({
        capabilities: {},
        category: 'utility',
        defaults: () => ({}),
        kind,
        schema: z.object({
          id: z.string(),
          metadata: z.record(z.string(), z.unknown()).default({}),
          object: z.literal('node').default('node'),
          parentId: z.string().nullable().default(null),
          pluginValue: z.number(),
          type: z.literal(kind),
          visible: z.boolean().default(true),
        }),
        schemaVersion: 1,
      } as unknown as AnyNodeDefinition)
    }
    const id = 'plugin_forward_compatible' as AnyNodeId
    const node = {
      forwardCompatible: { retained: true },
      id,
      metadata: {},
      object: 'node',
      parentId: null,
      pluginValue: 1,
      type: kind,
      visible: true,
    } as unknown as AnyNode
    useScene.setState({
      collections: {},
      dirtyNodes: new Set<AnyNodeId>(),
      materials: {},
      nodes: {},
      rootNodeIds: [],
    })
    clearSceneHistory()

    expect(
      applySceneOperationPatch({
        materialChanges: [],
        nodeCreates: [{ node, position: 0 }],
        nodeDeletes: [],
        nodeUpdates: [],
      }),
    ).toBe(true)
    expect(useScene.getState().nodes[id]).toEqual(node)

    expect(
      applySceneOperationPatch({
        materialChanges: [],
        nodeCreates: [],
        nodeDeletes: [],
        nodeUpdates: [
          {
            data: { pluginValue: 2 } as Partial<AnyNode>,
            id,
            removeFields: [],
          },
        ],
      }),
    ).toBe(true)
    expect(useScene.getState().nodes[id]).toMatchObject({
      forwardCompatible: { retained: true },
      pluginValue: 2,
    })
  })

  test('applies exact structural, field, and material changes in one host commit', () => {
    const replacementId = 'level_replacement' as AnyNodeId
    const replacement = LevelNode.parse({
      id: replacementId,
      parentId: BUILDING_ID,
      children: [],
      level: 1,
    })
    const materialId = 'mat_operation' as SceneMaterialId
    const material = SceneMaterial.parse({
      id: materialId,
      name: 'Operation material',
      material: { properties: { color: '#112233' } },
    })
    const deleted = useScene.getState().nodes[LEVEL_ID] as AnyNode
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))

    expect(
      applySceneOperationPatch({
        materialChanges: [{ id: materialId, material }],
        nodeCreates: [{ node: replacement, position: 0 }],
        nodeDeletes: [{ node: deleted, position: 0 }],
        nodeUpdates: [
          {
            id: BUILDING_ID,
            data: { visible: false } as Partial<AnyNode>,
            removeFields: [],
          },
        ],
      }),
    ).toBe(true)

    const state = useScene.getState()
    expect(state.nodes[LEVEL_ID]).toBeUndefined()
    expect(state.nodes[replacementId]).toEqual(replacement)
    expect((state.nodes[BUILDING_ID] as { children: AnyNodeId[] }).children).toEqual([
      replacementId,
    ])
    expect(state.nodes[BUILDING_ID]?.visible).toBe(false)
    expect(state.materials[materialId]).toEqual(material)
    expect(state.rootNodeIds).toEqual([BUILDING_ID])
    expect(commits.map((commit) => commit.origin)).toEqual(['host'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('does not leave deleted ancestors in the dirty set after subtree deletion', () => {
    const building = useScene.getState().nodes[BUILDING_ID] as AnyNode
    const level = useScene.getState().nodes[LEVEL_ID] as AnyNode

    expect(
      applySceneOperationPatch({
        materialChanges: [],
        nodeCreates: [],
        nodeDeletes: [
          { node: building, position: 0 },
          { node: level, position: 0 },
        ],
        nodeUpdates: [],
      }),
    ).toBe(true)

    expect(useScene.getState().nodes).toEqual({})
    expect(useScene.getState().rootNodeIds).toEqual([])
    expect(useScene.getState().dirtyNodes.has(BUILDING_ID)).toBe(false)
    expect(useScene.getState().dirtyNodes.has(LEVEL_ID)).toBe(false)
  })

  test('dirties surviving siblings after a remote structural deletion', () => {
    const siblingId = 'level_surviving_sibling' as AnyNodeId
    const sibling = LevelNode.parse({
      id: siblingId,
      parentId: BUILDING_ID,
      children: [],
      level: 1,
    })
    const building = useScene.getState().nodes[BUILDING_ID] as AnyNode
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [BUILDING_ID]: { ...building, children: [LEVEL_ID, siblingId] },
        [siblingId]: sibling,
      },
      dirtyNodes: new Set<AnyNodeId>(),
    })

    expect(
      applySceneOperationPatch({
        materialChanges: [],
        nodeCreates: [],
        nodeDeletes: [{ node: useScene.getState().nodes[LEVEL_ID] as AnyNode, position: 0 }],
        nodeUpdates: [],
      }),
    ).toBe(true)

    expect(useScene.getState().dirtyNodes.has(siblingId)).toBe(true)
  })

  test('preserves an external tool history pause while applying a remote patch', () => {
    useScene.temporal.getState().pause()
    expect(useScene.temporal.getState().isTracking).toBe(false)

    try {
      expect(
        applySceneOperationPatch({
          materialChanges: [],
          nodeCreates: [],
          nodeDeletes: [],
          nodeUpdates: [
            {
              data: { level: 2 } as Partial<AnyNode>,
              id: LEVEL_ID,
              removeFields: [],
            },
          ],
        }),
      ).toBe(true)
      expect(useScene.temporal.getState().isTracking).toBe(false)
    } finally {
      useScene.temporal.getState().resume()
    }
  })

  test('rejects an invalid structural operation before mutating any field or material', () => {
    const missingParentId = 'building_missing' as AnyNodeId
    const orphan = LevelNode.parse({
      id: 'level_orphan',
      parentId: missingParentId,
      children: [],
      level: 1,
    })
    const materialId = 'mat_rejected' as SceneMaterialId
    const material = SceneMaterial.parse({
      id: materialId,
      name: 'Rejected material',
      material: { properties: { color: '#abcdef' } },
    })
    const before = currentSnapshot()

    expect(
      applySceneOperationPatch({
        materialChanges: [{ id: materialId, material }],
        nodeCreates: [{ node: orphan, position: 0 }],
        nodeDeletes: [],
        nodeUpdates: [
          {
            id: LEVEL_ID,
            data: { level: 5 } as Partial<AnyNode>,
            removeFields: [],
          },
        ],
      }),
    ).toBe(false)

    expect(currentSnapshot()).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('keeps dirty work bounded when structurally patching a 10k-node scene', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {}
    const rootNodeIds: AnyNodeId[] = []
    for (let index = 0; index < 10_000; index += 1) {
      const id = `level_scale_${index}` as AnyNodeId
      nodes[id] = LevelNode.parse({ id, parentId: null, children: [], level: index })
      rootNodeIds.push(id)
    }
    useScene.setState({
      nodes,
      rootNodeIds,
      dirtyNodes: new Set<AnyNodeId>(),
      collections: {},
      materials: {},
    })
    clearSceneHistory()
    const created = LevelNode.parse({
      id: 'level_scale_created',
      parentId: null,
      children: [],
      level: 10_000,
    })

    expect(
      applySceneOperationPatch({
        materialChanges: [],
        nodeCreates: [{ node: created, position: rootNodeIds.length }],
        nodeDeletes: [],
        nodeUpdates: [],
      }),
    ).toBe(true)

    expect(useScene.getState().rootNodeIds.at(-1)).toBe(created.id)
    expect([...useScene.getState().dirtyNodes]).toEqual([created.id])
    expect(useScene.getState().nodes.level_scale_5000).toBe(nodes.level_scale_5000)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('applies a host snapshot as a history floor and clears live state', () => {
    useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useLiveNodeOverrides.getState().set(LEVEL_ID, { level: 99 })
    useLiveTransforms.getState().set(LEVEL_ID, { position: [1, 0, 1], rotation: 0 })

    const snapshot = currentSnapshot()
    snapshot.nodes = {
      ...snapshot.nodes,
      // Marker must survive the load migration: level ordinals renumber on
      // load, so the stored storey height marks the applied snapshot instead.
      [LEVEL_ID]: { ...snapshot.nodes[LEVEL_ID], height: 8 } as AnyNode,
    }
    snapshot.installedPlugins = ['pascal:trees']
    const commits: SceneCommit[] = []
    unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    useScene.getState().dirtyNodes.clear()

    expect(applySceneSnapshot(snapshot, { origin: 'host' })).toBe(true)
    expect((useScene.getState().nodes[LEVEL_ID] as { height?: number }).height).toBe(8)
    expect(useScene.getState().installedPlugins).toEqual(['pascal:trees'])
    expect(commits.map((commit) => commit.origin)).toEqual(['host'])
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useScene.temporal.getState().futureStates).toHaveLength(0)
    expect(useScene.getState().dirtyNodes.has(LEVEL_ID)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(BUILDING_ID)).toBe(true)
    expect(useLiveNodeOverrides.getState().get(LEVEL_ID)).toBeUndefined()
    expect(useLiveTransforms.getState().get(LEVEL_ID)).toBeUndefined()
  })

  test('rejects snapshot replacement during a paused interaction', () => {
    const snapshot = currentSnapshot()
    snapshot.nodes = {
      ...snapshot.nodes,
      [LEVEL_ID]: { ...snapshot.nodes[LEVEL_ID], level: 9 } as AnyNode,
    }

    pauseSceneHistory(useScene)
    try {
      expect(() => applySceneSnapshot(snapshot, { origin: 'host' })).toThrow('active interaction')
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
    const left: SceneSnapshot = {
      nodes,
      rootNodeIds: [],
      collections: {},
      installedPlugins: [],
      materials: {},
    }
    const right: SceneSnapshot = {
      ...left,
      nodes: { ...nodes, level_999: { ...nodes.level_999 } as AnyNode },
    }

    expect(areSceneSnapshotsEqual(left, right)).toBe(true)
  })
})
