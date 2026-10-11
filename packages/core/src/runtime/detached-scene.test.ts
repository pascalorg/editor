import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_OPERATIONS, applyAgentOutcome, editCollection } from '../agent-operations'
import { AGENT_TOOL_CASES } from '../agent-operations/__fixtures__/cases'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  type Collection,
  ItemNode,
  LevelNode,
  RoofNode,
  StairNode,
  StairSegmentNode,
  WallNode,
} from '../schema'
import { type SceneCommit, subscribeSceneCommits } from '../store/history-control'
import useScene, {
  applySceneOperationPatch,
  clearSceneHistory,
  getSceneDocument,
} from '../store/use-scene'
import { closeLiveScene, openLiveScene, settle, snapshotOf } from './__fixtures__/live-scene'
import {
  applyPatchWithDependencies,
  captureRegistryVersions,
  createSceneEnvironment,
  createSceneStore,
  type DetachedScene,
  effectIds,
  loadCanonicalSnapshot,
  openDetachedScene,
  queryNodes,
  SceneEnvironmentDisposedError,
  type SceneSnapshot,
  type SceneStore,
  sceneDocumentOf,
  untracked,
} from './index'

const context = () => ({
  activeLevelId: null,
  selection: [],
  units: 'metric' as const,
  catalogVersion: 'test',
  registryVersions: captureRegistryVersions(),
})

function open(snapshot: SceneSnapshot, effectId = 'effect'): DetachedScene {
  return openDetachedScene(snapshot, {
    base: { kind: 'authority', seq: 7 },
    context: context(),
    ids: effectIds(effectId),
  })
}

const document = (...nodes: AnyNode[]): SceneSnapshot =>
  snapshotOf({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.filter((node) => !node.parentId).map((node) => node.id),
  })

function caseScene(name: string): SceneSnapshot {
  const c = AGENT_TOOL_CASES.find((candidate) => candidate.name === name)!
  return snapshotOf(c.scene())
}

/** What a person does meanwhile, through the editor's own actions on a copy of `base`. */
function editedBy(base: SceneSnapshot, edit: (store: SceneStore) => void): SceneSnapshot {
  const store = createSceneStore(createSceneEnvironment('person'))
  loadCanonicalSnapshot(store, base)
  edit(store)
  return sceneDocumentOf(store)
}

function storeys() {
  const level = LevelNode.parse({ id: 'level_a', parentId: 'building_a', level: 0, height: 3 })
  const upper = LevelNode.parse({ id: 'level_b', parentId: 'building_a', level: 1, height: 3 })
  const building = BuildingNode.parse({ id: 'building_a', children: [level.id, upper.id] })
  return { level, upper, building }
}

describe('a detached scene is isolated', () => {
  afterEach(() => {
    closeLiveScene()
    clearSceneHistory()
  })

  test("its writes, commits and history never reach the editor's store", async () => {
    const live = await openLiveScene(
      caseScene('a wall on the level named, numbered as the editor numbers walls'),
    )
    const liveHistory = useScene.temporal.getState().pastStates
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    let notified = 0
    const unsubscribe = useScene.subscribe(() => {
      notified += 1
    })
    try {
      const scene = open(live)
      const other = open(live, 'other')
      scene.host().applyChanges({
        create: [
          { node: WallNode.parse({ start: [0, 2], end: [4, 2] }), parentId: 'level_ground' },
        ],
      })
      scene.store.temporal.getState().undo()
      scene.store.temporal.getState().redo()
      await settle()
      expect(Object.keys(scene.store.getState().nodes).length).toBeGreaterThan(
        Object.keys(live.nodes).length,
      )
      expect(sceneDocumentOf(other.store)).toEqual(live)
      expect(getSceneDocument()).toEqual(live)
      expect(useScene.temporal.getState().pastStates).toBe(liveHistory)
      expect(commits).toHaveLength(0)
      expect(notified).toBe(0)
      scene.dispose()
      other.dispose()
    } finally {
      stop()
      unsubscribe()
    }
  })

  test('history is its own', () => {
    const { level, upper, building } = storeys()
    const scene = open(document(building, level, upper))
    scene.host().applyChanges({ update: [{ id: level.id, data: { name: 'Ground' } }] })
    expect(scene.store.temporal.getState().pastStates).toHaveLength(1)
    scene.store.temporal.getState().undo()
    expect(scene.store.getState().nodes[level.id]?.name).toBeUndefined()
    expect(scene.patch().nodeUpdates).toEqual([])
  })
})

describe('disposal', () => {
  test('every later read or write throws, including a late async one', async () => {
    const { level, upper, building } = storeys()
    const scene = open(document(building, level, upper))
    const host = scene.host()
    const view = scene.reader().get(level.id)!
    const late = (async () => {
      await Promise.resolve()
      host.applyChanges({ update: [{ id: level.id, data: { name: 'Late' } }] })
    })()
    scene.dispose()
    expect(scene.disposed).toBe(true)
    await expect(late).rejects.toBeInstanceOf(SceneEnvironmentDisposedError)
    expect(() => view.height).toThrow(SceneEnvironmentDisposedError)
    expect(() => scene.reader().get(level.id)).toThrow(SceneEnvironmentDisposedError)
    expect(() => scene.reader().nodes).toThrow(SceneEnvironmentDisposedError)
    expect(() => scene.patch()).toThrow(SceneEnvironmentDisposedError)
    expect(() => scene.store.getState()).toThrow(SceneEnvironmentDisposedError)
  })
})

describe('ids', () => {
  const run = (effectId: string) => {
    const c = AGENT_TOOL_CASES.find((candidate) => candidate.tool === 'create_room')!
    const scene = open(snapshotOf(c.scene()), effectId)
    const input = z
      .object(AGENT_TOOL_CONTRACTS.find((contract) => contract.name === 'create_room')!.input)
      .parse(c.input)
    scene.execute(AGENT_OPERATIONS.create_room, input as never, { activeLevelId: null })
    const patch = scene.patch()
    scene.dispose()
    return patch.nodeCreates.map(({ node }) => node.id)
  }

  test('the same effect mints the same ids, derived construction included; another effect others', () => {
    const first = run('effect_1')
    expect(first.length).toBeGreaterThan(1)
    expect(run('effect_1')).toEqual(first)
    expect(run('effect_2').some((id) => first.includes(id))).toBe(false)
  })
})

describe('the recorder', () => {
  test('records the fields read, not the fields copied through', () => {
    const { level, upper, building } = storeys()
    const scene = open(document(building, level, upper))
    const reader = scene.reader()
    void reader.get(level.id)!.height
    const copy = { ...untracked(reader.get(upper.id)!) }
    expect(copy.height).toBe(3)
    expect(scene.dependencies()).toEqual([
      { kind: 'node', id: level.id, fields: ['height'] },
      { kind: 'node', id: upper.id, fields: [] },
    ])
  })

  test('records a query with its absent matches, and the order only where it is read', () => {
    const { level, upper, building } = storeys()
    const scene = open(document(building, level, upper))
    expect(queryNodes(scene.reader().nodes, { type: 'stair' })).toEqual([])
    queryNodes(scene.reader().nodes, { parentId: building.id })
    scene.reader().orderedChildren(building.id)
    expect(scene.dependencies()).toEqual(
      expect.arrayContaining([
        { kind: 'query', entity: 'node', predicate: { type: 'stair' }, resultIds: [] },
        {
          kind: 'query',
          entity: 'node',
          predicate: { parentId: building.id },
          resultIds: [level.id, upper.id],
        },
        { kind: 'order', parentId: building.id, childIds: [level.id, upper.id] },
      ]),
    )
  })
})

describe('applyPatchWithDependencies', () => {
  test('a stair re-sized while its flights were reordered conflicts: the riser split read their order', () => {
    const { level, upper, building } = storeys()
    const first = StairSegmentNode.parse({
      id: 'sseg_first',
      length: 2.5,
      height: 1.5,
      stepCount: 8,
    })
    const second = StairSegmentNode.parse({
      id: 'sseg_second',
      length: 2.5,
      height: 1.5,
      stepCount: 8,
    })
    const stair = StairNode.parse({
      id: 'stair_a',
      parentId: level.id,
      children: [first.id, second.id],
    })
    first.parentId = stair.id
    second.parentId = stair.id
    level.children = [stair.id]
    const base = document(building, level, upper, stair, first, second)
    const scene = open(base)
    scene.execute(AGENT_OPERATIONS.fit_stair, { stairId: stair.id, fitRun: false } as never, {
      activeLevelId: null,
    })
    const patch = scene.patch()
    expect(patch.nodeUpdates.map(({ id }) => id)).toContain(first.id)
    const current = editedBy(base, (store) =>
      store.getState().updateNode(stair.id, { children: [second.id, first.id] }),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(applied.ok).toBe(false)
    expect(!applied.ok && applied.changed).toContainEqual(
      expect.objectContaining({ id: stair.id, reason: 'dependency' }),
    )
  })

  test('independent insertions on the same level both land, each where it was put', () => {
    const c = AGENT_TOOL_CASES.find(
      (candidate) =>
        candidate.name === 'items stand on the floor of the level named, turned in degrees',
    )!
    const base = snapshotOf(c.scene())
    const scene = open(base)
    const input = z
      .object(AGENT_TOOL_CONTRACTS.find((contract) => contract.name === 'place_items')!.input)
      .parse(c.input)
    scene.execute(AGENT_OPERATIONS.place_items, input as never, {
      activeLevelId: null,
      catalog: c.context?.catalog,
    })
    const patch = scene.patch()
    const placed = patch.nodeCreates.map(({ node }) => node.id)
    expect(placed).toHaveLength(2)
    const theirs = ItemNode.parse({
      id: 'item_theirs',
      asset: {
        id: 'chair',
        name: 'Chair',
        category: 'furniture',
        thumbnail: '/items/chair/thumbnail.webp',
        src: '/items/chair/model.glb',
      },
      position: [5, 0, 5],
    })
    const current = editedBy(base, (store) => store.getState().createNode(theirs, 'level_ground'))
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const children = (applied.next.nodes['level_ground' as AnyNodeId] as { children: string[] })
      .children
    expect(children).toEqual([
      ...(base.nodes['level_ground' as AnyNodeId] as { children: string[] }).children,
      ...placed,
      theirs.id,
    ])
    for (const id of [...placed, theirs.id])
      expect(applied.next.nodes[id as AnyNodeId]).toBeDefined()
  })

  const lights: Collection = {
    id: 'collection_lights' as Collection['id'],
    name: 'Lights',
    color: '#ffffff',
    nodeIds: [],
  }
  const withLights = () => {
    const { level, upper, building } = storeys()
    return { ...document(building, level, upper), collections: { [lights.id]: lights } }
  }
  const editCollectionIn = (base: SceneSnapshot, input: Parameters<typeof editCollection>[1]) => {
    const scene = open(base)
    const result = scene.run(() =>
      applyAgentOutcome(
        editCollection(
          { nodes: scene.reader().nodes, collections: scene.reader().collections },
          input,
        ),
        scene.host(),
      ),
    )
    return { scene, result, patch: scene.patch() }
  }

  test('a rename lands beside a recolour made meanwhile', () => {
    const base = withLights()
    const { scene, patch } = editCollectionIn(base, { collectionId: lights.id, name: 'Lighting' })
    const current = editedBy(base, (store) =>
      store.getState().updateCollection(lights.id, { color: '#000000' }),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(applied.ok && applied.next.collections[lights.id]).toEqual({
      ...lights,
      name: 'Lighting',
      color: '#000000',
    })
  })

  test('two renames conflict', () => {
    const base = withLights()
    const { scene, patch } = editCollectionIn(base, { collectionId: lights.id, name: 'Lighting' })
    const current = editedBy(base, (store) =>
      store.getState().updateCollection(lights.id, { name: 'Lamps' }),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toEqual([
      { kind: 'collection', id: lights.id, field: 'name', reason: 'write' },
    ])
  })

  test('a collection created because none had the name conflicts with one created meanwhile', () => {
    const base = withLights()
    const { scene, patch } = editCollectionIn(base, { name: 'Kitchen' })
    expect(patch.collectionChanges).toHaveLength(1)
    const current = editedBy(base, (store) => {
      store.getState().createCollection('kitchen')
    })
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'query',
      id: 'collection',
      reason: 'dependency',
    })
  })

  test('a level added while another was added conflicts: the floor index read the levels', () => {
    const { level, upper, building } = storeys()
    const base = document(building, level, upper)
    const scene = open(base)
    scene.execute(AGENT_OPERATIONS.add_level, { buildingId: building.id } as never, {
      activeLevelId: null,
    })
    const patch = scene.patch()
    const current = editedBy(base, (store) =>
      store.getState().createNode(LevelNode.parse({ level: 2, height: 3 }), building.id),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'query',
      id: 'node',
      reason: 'dependency',
    })
  })

  test('a field written by both conflicts; other fields of the same node merge', () => {
    const { level, upper, building } = storeys()
    const base = document(building, level, upper)
    const scene = open(base)
    scene.host().applyChanges({ update: [{ id: level.id, data: { name: 'Ground' } }] })
    const patch = scene.patch()
    const merged = applyPatchWithDependencies(
      editedBy(base, (store) => store.getState().updateNode(level.id, { height: 3.2 })),
      patch,
      scene.dependencies(),
      base,
    )
    expect(merged.ok && merged.next.nodes[level.id]).toMatchObject({ name: 'Ground', height: 3.2 })
    const clashed = applyPatchWithDependencies(
      editedBy(base, (store) => store.getState().updateNode(level.id, { name: 'Street' })),
      patch,
      scene.dependencies(),
      base,
    )
    expect(!clashed.ok && clashed.changed).toEqual([
      { kind: 'node', id: level.id, field: 'name', reason: 'write' },
    ])
  })
})

describe('reconciliation', () => {
  afterEach(closeLiveScene)

  /** Walls under a wall-supported roof one storey up, from the roof system's own case. */
  function roofScene(): SceneSnapshot {
    const level = LevelNode.parse({
      id: 'level_walls',
      parentId: 'building_r',
      height: 3,
      level: 0,
    })
    const upper = LevelNode.parse({ id: 'level_roof', parentId: 'building_r', height: 3, level: 1 })
    const corners: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const walls = corners.map((start, index) =>
      WallNode.parse({
        id: `wall_${index}`,
        parentId: level.id,
        start,
        end: corners[(index + 1) % 4]!,
        height: 3,
      }),
    )
    const roof = RoofNode.parse({
      id: 'roof_r',
      parentId: upper.id,
      support: { kind: 'walls' },
      position: [2, 0, 1.5],
    })
    level.children = walls.map((wall) => wall.id)
    upper.children = [roof.id]
    const building = BuildingNode.parse({ id: 'building_r', children: [level.id, upper.id] })
    return document(building, level, upper, ...walls, roof)
  }

  test('a wall raised detached carries the roof it holds up, and the editor then writes nothing', async () => {
    const base = await openLiveScene(roofScene())
    const scene = open(base)
    scene.host().applyChanges({ update: [{ id: 'wall_0', data: { height: 4.2 } }] })
    const patch = scene.patch()
    const roofUpdate = patch.nodeUpdates.find(({ id }) => id === 'roof_r')
    // The walls rose 1.2 m above the storey: the roof rises with them.
    expect((roofUpdate?.data.position as number[] | undefined)?.[1]).toBeGreaterThan(1.2)

    // Live, the same edit through the editor's own systems lands on the same roof.
    useScene.getState().updateNode('wall_0' as AnyNodeId, { height: 4.2 })
    await settle()
    expect(getSceneDocument().nodes['roof_r' as AnyNodeId]).toEqual(
      scene.store.getState().nodes['roof_r' as AnyNodeId],
    )

    const appliedCommits = async (applied: typeof patch) => {
      await openLiveScene(base)
      const commits: SceneCommit[] = []
      const stop = subscribeSceneCommits((commit) => commits.push(commit))
      applySceneOperationPatch(applied, { undoable: true })
      await settle()
      stop()
      return commits.length
    }
    expect(await appliedCommits(patch)).toBe(1)
    // Without the derived write, the editor's roof system adds its own commit after the patch.
    expect(
      await appliedCommits({
        ...patch,
        nodeUpdates: patch.nodeUpdates.filter(({ id }) => id !== 'roof_r'),
      }),
    ).toBe(2)
  })
})
