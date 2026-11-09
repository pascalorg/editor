import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  AGENT_OPERATIONS,
  applyAgentOutcome,
  editCollection,
  type SceneChanges,
} from '../agent-operations'
import { AGENT_TOOL_CASES } from '../agent-operations/__fixtures__/cases'
import { AGENT_TOOL_CONTRACTS } from '../agent-tools'
import { activeSpatialGrid } from '../hooks/spatial-grid/spatial-grid-manager'
import { initSpaceDetectionSync } from '../lib/space-detection'
import { encodeTerrainField } from '../lib/terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from '../lib/terrain-field'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  type Collection,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { SceneMaterial } from '../schema/scene-material'
import { type SceneCommit, subscribeSceneCommits } from '../store/history-control'
import useLiveTerrain from '../store/use-live-terrain'
import useScene, {
  applySceneOperationPatch,
  clearSceneHistory,
  getSceneDocument,
} from '../store/use-scene'
import { planRoofElevationUpdates } from '../systems/roof/roof-elevation'
import { closeLiveScene, openLiveScene, settle, snapshotOf } from './__fixtures__/live-scene'
import {
  applyPatchWithDependencies,
  captureRegistryVersions,
  createAgentHost,
  createSceneEnvironment,
  createSceneStore,
  type DetachedScene,
  draftOf,
  effectIds,
  isEmptyScenePatch,
  liveSceneRuntime,
  loadCanonicalSnapshot,
  openDetachedScene,
  orderedChildIds,
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
  function roofScene(site?: { terrain?: unknown }, open = false): SceneSnapshot {
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
    // Open (two walls, no room): the walls stand on the ground itself rather than a floor plate.
    const walls = corners.slice(0, open ? 2 : 4).map((start, index) =>
      WallNode.parse({
        id: `wall_${index}`,
        parentId: level.id,
        start,
        end: corners[(index + 1) % 4]!,
        height: 3,
      }),
    )
    const segment = RoofSegmentNode.parse({ id: 'rseg_r', parentId: 'roof_r', width: 4, depth: 3 })
    const roof = RoofNode.parse({
      id: 'roof_r',
      parentId: upper.id,
      support: { kind: 'walls' },
      position: [2, 0, 1.5],
      children: open ? [segment.id] : [],
    })
    level.children = walls.map((wall) => wall.id)
    upper.children = [roof.id]
    if (open) walls.push(segment as never)
    const building = BuildingNode.parse({
      id: 'building_r',
      children: [level.id, upper.id],
      ...(site ? { parentId: 'site_r' } : {}),
    })
    if (!site) return document(building, level, upper, ...walls, roof)
    const ground = SiteNode.parse({ id: 'site_r', children: [building.id], ...site })
    return document(ground, building, level, upper, ...walls, roof)
  }

  const flatGround = () => createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  /** Ground raised 1 m under the walls. */
  function raisedGround() {
    const flat = flatGround()
    return applyHeightPatch(
      flat,
      flattenPatch(flat, { minX: -2, minZ: -2, maxX: 6, maxZ: 5 }, 1) as never,
    )
  }

  test("an agent's edit on the editor's store commits once, with the roof it moved, in one undo step", async () => {
    const base = await openLiveScene(roofScene())
    const past = useScene.temporal.getState().pastStates.length
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      createAgentHost(liveSceneRuntime).applyChanges({
        update: [{ id: 'wall_0', data: { height: 4.2 } }],
      })
      await settle()
    } finally {
      stop()
    }
    const roof = getSceneDocument().nodes['roof_r' as AnyNodeId] as AnyNode & {
      position: number[]
    }
    expect(roof.position[1]).toBeGreaterThan(1.2)
    expect(commits).toHaveLength(1)
    expect(commits[0]!.current.nodes['roof_r' as AnyNodeId]).toEqual(roof)
    expect(commits[0]!.changedNodeIds).toContain('roof_r' as AnyNodeId)
    expect(useScene.temporal.getState().pastStates).toHaveLength(past + 1)
    useScene.temporal.getState().undo()
    await settle()
    expect(getSceneDocument().nodes['roof_r' as AnyNodeId]).toEqual(
      base.nodes['roof_r' as AnyNodeId],
    )
    expect(getSceneDocument().nodes['wall_0' as AnyNodeId]).toEqual(
      base.nodes['wall_0' as AnyNodeId],
    )
  })

  test("a room an agent settles on the editor's store is not derived again by the person's next edit", async () => {
    const { level, upper, building } = storeys()
    await openLiveScene(document(building, level, upper))
    let published = 0
    const editor = {
      getState: () => ({
        spaces: {},
        setSpaces: () => {
          published += 1
        },
      }),
    }
    const stop = initSpaceDetectionSync(useScene, editor)
    try {
      const corners: [number, number][] = [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ]
      createAgentHost(liveSceneRuntime).applyChanges({
        create: corners.map((start, i) => ({
          node: WallNode.parse({
            id: `wall_${i}`,
            parentId: level.id,
            start,
            end: corners[(i + 1) % corners.length]!,
          }),
          parentId: level.id,
        })),
      })
      await settle()
      expect(
        queryNodes(useScene.getState().nodes as never, { type: 'zone', parentId: level.id }),
      ).toHaveLength(1)

      // A write that changes no level's structure: space detection has nothing to derive.
      published = 0
      const nodes = useScene.getState().nodes
      useScene.setState({
        nodes: { ...nodes, [building.id]: { ...nodes[building.id]!, name: 'Renamed' } as AnyNode },
      })
      await settle()
      expect(published).toBe(0)
    } finally {
      stop()
    }
  })

  test('a terrain stroke in progress reaches no detached computation', () => {
    const base = roofScene({ terrain: encodeTerrainField(flatGround()) }, true)
    const raise = () => {
      const scene = open(base)
      scene.host().applyChanges({ update: [{ id: 'wall_0', data: { height: 4.2 } }] })
      const patch = scene.patch()
      scene.dispose()
      return patch
    }
    const still = raise()
    useLiveTerrain.getState().begin('site_r', raisedGround())
    try {
      expect(raise()).toEqual(still)
    } finally {
      useLiveTerrain.getState().end('site_r')
    }
  })

  test("a ceiling placement read depends on the ceiling's level: a lamp moved there meanwhile conflicts", () => {
    const lamp = ItemNode.parse({
      id: 'item_lamp',
      parentId: 'ceiling_c',
      position: [3, 0, 3],
      asset: {
        id: 'lamp',
        name: 'Lamp',
        category: 'lighting',
        thumbnail: '/items/lamp/thumbnail.webp',
        src: '/items/lamp/model.glb',
        attachTo: 'ceiling',
        dimensions: [0.5, 0.2, 0.5],
      },
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_c',
      parentId: 'level_c',
      children: [lamp.id],
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const level = LevelNode.parse({
      id: 'level_c',
      parentId: 'building_c',
      level: 0,
      height: 3,
      children: [ceiling.id],
    })
    const building = BuildingNode.parse({ id: 'building_c', children: [level.id] })
    const base = document(building, level, ceiling, lamp)
    const scene = open(base)
    const free = scene.run(() =>
      activeSpatialGrid().canPlaceOnCeiling(ceiling.id, [1, 0, 1], [0.5, 0.2, 0.5], [0, 0, 0]),
    )
    expect(free.valid).toBe(true)
    expect(scene.dependencies()).toContainEqual({ kind: 'scope', level: level.id })

    const current = editedBy(base, (store) =>
      store.getState().updateNode(lamp.id, { position: [1.2, 0, 1] }),
    )
    const applied = applyPatchWithDependencies(current, scene.patch(), scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'scope',
      id: level.id,
      reason: 'dependency',
    })
  })

  test("support read on a level depends on what it stands on: the site's terrain", () => {
    const base = roofScene({})
    const scene = open(base)
    scene.host().applyChanges({ update: [{ id: 'wall_0', data: { height: 4.2 } }] })
    const patch = scene.patch()
    const current = editedBy(base, (store) =>
      store.getState().updateNode(
        'site_r' as AnyNodeId,
        {
          terrain: encodeTerrainField(raisedGround()),
        } as never,
      ),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'node',
      id: 'site_r',
      field: 'terrain',
      reason: 'dependency',
    })
  })

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

describe('what a detached scene hands out', () => {
  test('is its own, read-only data: nothing reached through it changes the snapshot or the scene', () => {
    const { level, upper, building } = storeys()
    const snapshot = document(building, level, upper)
    const scene = open(snapshot)
    const children = scene.reader().get(building.id)!.children as string[]
    expect(() => children.push('level_x')).toThrow(TypeError)
    expect((snapshot.nodes[building.id as AnyNodeId] as typeof building).children).toEqual([
      level.id,
      upper.id,
    ])
    ;(snapshot.nodes[building.id as AnyNodeId] as typeof building).children.push('level_y' as never)
    expect(scene.reader().get(building.id)!.children).toEqual([level.id, upper.id])
    expect(isEmptyScenePatch(scene.patch())).toBe(true)
  })

  test("takes its own copy of what it is given: the caller's data stays the caller's", () => {
    const { level, upper, building } = storeys()
    const scene = open(document(building, level, upper))
    const metadata = { note: { tags: ['one'] } }
    scene.host().applyChanges({ update: [{ id: level.id, data: { metadata } }] })
    metadata.note.tags.push('two')
    expect(scene.store.getState().nodes[level.id as AnyNodeId]?.metadata).toEqual({
      note: { tags: ['one'] },
    })
  })

  test('selections over an earlier version read that version', () => {
    const { level, upper, building } = storeys()
    const scene = open(document(building, level, upper))
    const before = scene.reader().nodes
    scene.host().applyChanges({
      create: [{ node: RoofNode.parse({ id: 'roof_new' }), parentId: upper.id }],
    })
    expect(before.roof_new).toBeUndefined()
    expect(queryNodes(before, { type: 'roof' })).toEqual([])
    expect(queryNodes(scene.reader().nodes, { type: 'roof' })).toHaveLength(1)
    expect(orderedChildIds(before, upper.id)).toEqual([])
  })

  test('a draft over the scene reads what it is asked for, and selects as a copy would', () => {
    const { level, upper, building } = storeys()
    const roof = RoofNode.parse({ id: 'roof_a', parentId: upper.id })
    const kept = RoofNode.parse({ id: 'roof_b', parentId: upper.id })
    const scene = open(
      document(building, { ...level }, { ...upper, children: [roof.id, kept.id] }, roof, kept),
    )
    const nodes = scene.reader().nodes
    const draft = draftOf(nodes)
    const copy = { ...untracked(nodes) } as Record<string, AnyNode>
    const added = RoofNode.parse({ id: 'roof_c', parentId: level.id })
    for (const record of [draft, copy]) {
      record[added.id] = added
      delete record[roof.id]
      record[kept.id] = { ...record[kept.id]!, parentId: level.id } as AnyNode
    }
    const whole = expect.objectContaining({ kind: 'query', predicate: null })
    expect(draft[roof.id]).toBeUndefined()
    expect(queryNodes(draft, { type: 'roof' })).toEqual(queryNodes(copy, { type: 'roof' }))
    expect(scene.dependencies()).not.toContainEqual(whole)
    // A roof the draft moved onto the level: only the whole draft knows where it stands.
    expect(queryNodes(draft, { type: 'roof', parentId: level.id })).toEqual(
      queryNodes(copy, { type: 'roof', parentId: level.id }),
    )
    expect(scene.dependencies()).toContainEqual(whole)
    expect(Object.keys(draft)).toEqual(Object.keys(copy))
  })

  test('materials read are dependencies', () => {
    const { level, upper, building } = storeys()
    const red = SceneMaterial.parse({ id: 'mat_red', name: 'Red', material: { color: '#ff0000' } })
    const base = { ...document(building, level, upper), materials: { [red.id]: red } }
    const scene = open(base as SceneSnapshot)
    const [material] = scene.reader().query({ entity: 'material' })
    scene.host().applyChanges({ update: [{ id: level.id, data: { name: material!.name } }] })
    const current = editedBy(base as SceneSnapshot, (store) =>
      store.getState().updateSceneMaterial(red.id, { name: 'Blue' }),
    )
    const applied = applyPatchWithDependencies(
      current,
      scene.patch(),
      scene.dependencies(),
      base as SceneSnapshot,
    )
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'material',
      id: red.id,
      reason: 'dependency',
    })
  })
})

describe('what the store actions plan', () => {
  test('writes an action plans beyond the changes depend on their level', () => {
    const level = LevelNode.parse({ id: 'level_r', parentId: 'building_g', level: 0, height: 3 })
    const segment = RoofSegmentNode.parse({ id: 'rseg_g', parentId: 'roof_g', width: 8, depth: 6 })
    const roof = RoofNode.parse({ id: 'roof_g', parentId: level.id, children: [segment.id] })
    level.children = [roof.id]
    const building = BuildingNode.parse({ id: 'building_g', children: [level.id] })
    const base = document(building, level, roof, segment)
    const scene = open(base)
    scene.host().applyChanges({
      update: [{ id: segment.id, data: { metadata: { autoGutter: true } } }],
    })
    const patch = scene.patch()
    expect(patch.nodeCreates.some(({ node }) => node.type === 'gutter')).toBe(true)
    const current = editedBy(base, (store) =>
      store.getState().updateNode(segment.id, { width: 12 }),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'scope',
      id: level.id,
      reason: 'dependency',
    })
  })

  test("a rename runs no planner: a segment's name reads nothing of its level", () => {
    const level = LevelNode.parse({ id: 'level_r', parentId: 'building_g', level: 0, height: 3 })
    const segment = RoofSegmentNode.parse({ id: 'rseg_g', parentId: 'roof_g', width: 8, depth: 6 })
    const roof = RoofNode.parse({ id: 'roof_g', parentId: level.id, children: [segment.id] })
    const wall = WallNode.parse({ id: 'wall_g', parentId: level.id, start: [9, 0], end: [12, 0] })
    level.children = [roof.id, wall.id]
    const building = BuildingNode.parse({ id: 'building_g', children: [level.id] })
    const base = document(building, level, roof, segment, wall)
    const scene = open(base)
    scene.host().applyChanges({ update: [{ id: segment.id, data: { name: 'South slope' } }] })
    const current = editedBy(base, (store) =>
      store.getState().updateNode(wall.id, { name: 'Garden wall' }),
    )
    const applied = applyPatchWithDependencies(current, scene.patch(), scene.dependencies(), base)
    expect(applied.ok).toBe(true)
  })

  test('a planner that decided to write nothing was still read: disabled gutters', () => {
    const level = LevelNode.parse({ id: 'level_r', parentId: 'building_g', level: 0, height: 3 })
    const segment = RoofSegmentNode.parse({ id: 'rseg_g', parentId: 'roof_g', width: 8, depth: 6 })
    const roof = RoofNode.parse({ id: 'roof_g', parentId: level.id, children: [segment.id] })
    level.children = [roof.id]
    const building = BuildingNode.parse({ id: 'building_g', children: [level.id] })
    const base = document(building, level, roof, segment)
    const scene = open(base)
    scene.host().applyChanges({ update: [{ id: segment.id, data: { width: 12 } }] })
    const patch = scene.patch()
    expect(patch.nodeCreates).toEqual([])
    const current = editedBy(base, (store) =>
      store.getState().updateNode(segment.id, { metadata: { autoGutter: true } }),
    )
    const applied = applyPatchWithDependencies(current, patch, scene.dependencies(), base)
    expect(!applied.ok && applied.changed).toContainEqual({
      kind: 'scope',
      id: level.id,
      reason: 'dependency',
    })
  })
})

describe('scoped reconciliation settles what complete reconciliation would', () => {
  /** The same edit settled as an edit, and settled whole: every level, every roof. */
  function scopedAndComplete(base: SceneSnapshot, changes: SceneChanges) {
    const scoped = open(base, 'scoped')
    scoped.host().applyChanges(changes)
    const complete = open(base, 'complete')
    complete.host().applyChanges(changes)
    complete.host().reconcile()
    complete
      .host()
      .applyChanges({ update: planRoofElevationUpdates(complete.store.getState().nodes) })
    return { scoped: scoped.store.getState().nodes, complete: complete.store.getState().nodes }
  }

  test('a roof segment added over a taller wall moves the roof', () => {
    const level = LevelNode.parse({ id: 'level_t', parentId: 'building_t', level: 0, height: 6 })
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
        height: 2,
      }),
    )
    const tall = WallNode.parse({
      id: 'wall_tall',
      parentId: level.id,
      start: [6, 0],
      end: [6, 3],
      height: 5,
    })
    const roof = RoofNode.parse({
      id: 'roof_t',
      parentId: level.id,
      support: { kind: 'walls' },
      position: [2, 2, 1.5],
    })
    level.children = [...walls.map((wall) => wall.id), tall.id, roof.id]
    const building = BuildingNode.parse({ id: 'building_t', children: [level.id] })
    const base = document(building, level, ...walls, tall, roof)
    const segment = RoofSegmentNode.parse({ id: 'rseg_t', width: 10, depth: 4 })
    const { scoped, complete } = scopedAndComplete(base, {
      create: [{ node: segment, parentId: roof.id }],
    })
    const y = (nodes: Record<string, AnyNode>) => (nodes.roof_t as RoofNode).position[1]
    expect(y(complete)).toBeCloseTo(5)
    expect(y(scoped)).toBeCloseTo(y(complete))
  })

  /** A storey of plane-bound walls under a slab on the level above, its roof on the walls. */
  function slabRoofBuilding(id: string, x = 0): AnyNode[] {
    const level = LevelNode.parse({
      id: `level_${id}0`,
      parentId: `building_${id}`,
      level: 0,
      height: 3,
    })
    const upper = LevelNode.parse({
      id: `level_${id}1`,
      parentId: `building_${id}`,
      level: 1,
      height: 3,
    })
    const corners: [number, number][] = [
      [x, 0],
      [x + 4, 0],
      [x + 4, 3],
      [x, 3],
    ]
    const walls = corners.map((start, index) =>
      WallNode.parse({
        id: `wall_${id}${index}`,
        parentId: level.id,
        start,
        end: corners[(index + 1) % 4]!,
      }),
    )
    const roof = RoofNode.parse({
      id: `roof_${id}`,
      parentId: level.id,
      support: { kind: 'walls' },
      position: [x + 2, 0, 1.5],
    })
    const slab = SlabNode.parse({
      id: `slab_${id}`,
      parentId: upper.id,
      polygon: [
        [x - 1, -1],
        [x + 5, -1],
        [x + 5, 4],
        [x - 1, 4],
      ],
      thickness: 0.05,
    })
    level.children = [...walls.map((wall) => wall.id), roof.id]
    upper.children = [slab.id]
    const building = BuildingNode.parse({ id: `building_${id}`, children: [level.id, upper.id] })
    return [building, level, upper, ...walls, roof, slab]
  }

  function settledScene(...nodes: AnyNode[]): SceneSnapshot {
    const settled = open(document(...nodes), 'settle')
    settled.host().reconcile()
    settled
      .host()
      .applyChanges({ update: planRoofElevationUpdates(settled.store.getState().nodes) })
    return sceneDocumentOf(settled.store)
  }

  test('a thicker slab above lowers plane-bound walls and the roof they carry', () => {
    const base = settledScene(...slabRoofBuilding('s'))
    const { scoped, complete } = scopedAndComplete(base, {
      update: [{ id: 'slab_s', data: { thickness: 0.55 } }],
    })
    const y = (nodes: Record<string, AnyNode>) => (nodes.roof_s as RoofNode).position[1]
    expect(y(complete)).not.toBeCloseTo(y(base.nodes as Record<string, AnyNode>))
    expect(y(scoped)).toBeCloseTo(y(complete))
  })

  test("a slab edit in one building reads nothing of another's", () => {
    const base = settledScene(...slabRoofBuilding('a'), ...slabRoofBuilding('b', 20))
    const scene = open(base)
    scene.host().applyChanges({ update: [{ id: 'slab_a', data: { thickness: 0.55 } }] })
    const current = editedBy(base, (store) =>
      store.getState().updateNode('wall_b0' as AnyNodeId, { name: 'North' }),
    )
    const applied = applyPatchWithDependencies(current, scene.patch(), scene.dependencies(), base)
    expect(applied.ok).toBe(true)
  })

  test('an upper slab no longer recessed clamps the ceiling below', () => {
    const level = LevelNode.parse({ id: 'level_0', parentId: 'building_c', level: 0, height: 2.5 })
    const upper = LevelNode.parse({ id: 'level_1', parentId: 'building_c', level: 1, height: 3 })
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const walls = polygon.map((start, index) =>
      WallNode.parse({
        id: `wall_${index}`,
        parentId: level.id,
        start,
        end: polygon[(index + 1) % 4]!,
      }),
    )
    const zone = ZoneNode.parse({
      id: 'zone_c',
      parentId: level.id,
      name: 'Room',
      polygon,
      spaceRole: 'room',
    })
    const slab = SlabNode.parse({
      id: 'slab_above',
      parentId: upper.id,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 4],
        [-1, 4],
      ],
      thickness: 0.3,
      recessed: true,
    })
    level.children = [...walls.map((wall) => wall.id), zone.id]
    upper.children = [slab.id]
    const building = BuildingNode.parse({ id: 'building_c', children: [level.id, upper.id] })
    const settled = open(document(building, level, upper, ...walls, zone, slab), 'settle')
    settled.host().reconcile()
    const ceiling = Object.values(settled.store.getState().nodes).find(
      (node) => node.type === 'ceiling',
    )!
    // Just under the storey, as a recessed slab above allows.
    settled.host().applyChanges({ update: [{ id: ceiling.id, data: { height: 2.49 } }] })
    const base = sceneDocumentOf(settled.store)
    expect((base.nodes[ceiling.id] as { height?: number }).height).toBe(2.49)
    const { scoped, complete } = scopedAndComplete(base, {
      update: [{ id: slab.id, data: { recessed: false } }],
    })
    const ceilings = (nodes: Record<string, AnyNode>) =>
      Object.values(nodes)
        .filter((node) => node.type === 'ceiling')
        .map((node) => JSON.stringify(node))
    expect(ceilings(complete)).not.toEqual(ceilings(base.nodes as Record<string, AnyNode>))
    expect(ceilings(scoped)).toEqual(ceilings(complete))
  })
})
