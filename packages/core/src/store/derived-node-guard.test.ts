import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { initSpaceDetectionSync, type Space } from '../lib/space-detection'
import { createSceneApi } from '../registry/scene-api'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  type ZoneNode,
} from '../schema'
import { DERIVED_WRITER_TOKEN, filterDerivedNodeWrites } from './derived-node-guard'
import { subscribeSceneCommits } from './history-control'
import useScene, { applySceneOperationPatch, clearSceneHistory } from './use-scene'

const levelId = 'level_derived_guard'
const buildingId = 'building_derived_guard'
const polygon: Array<[number, number]> = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
const hole: Array<[number, number]> = [
  [2, 1],
  [3, 1],
  [3, 2],
  [2, 2],
]
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let previousState: ReturnType<typeof useScene.getState>
let stopDetection = () => {}

beforeEach(() => {
  previousState = useScene.getState()
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
})

afterEach(() => {
  stopDetection()
  useScene.setState(previousState, true)
  clearSceneHistory()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

function startDetection() {
  const editor = {
    spaces: {} as Record<string, Space>,
    setSpaces(spaces: Record<string, Space>) {
      this.spaces = spaces
    },
  }
  stopDetection = initSpaceDetectionSync(useScene, { getState: () => editor })
  return editor
}

/** Three walls in the store, the fourth returned so a test can close the loop. */
function openRoom() {
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      id: `wall_derived_guard_${index}`,
      parentId: levelId,
      start,
      end: polygon[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const initial = [
    BuildingNode.parse({ id: buildingId, children: [levelId] }),
    LevelNode.parse({
      id: levelId,
      parentId: buildingId,
      level: 0,
      height: 2.5,
      children: walls.slice(0, 3).map((wall) => wall.id),
    }),
    ...walls.slice(0, 3),
  ]
  useScene.setState({
    nodes: Object.fromEntries(initial.map((node) => [node.id, node])),
    rootNodeIds: [buildingId],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  clearSceneHistory()
  startDetection()
  return walls
}

function closeRoom() {
  const walls = openRoom()
  useScene.getState().createNode(walls[3]!, levelId)
  return walls
}

function nodesOfType<T extends AnyNode['type']>(type: T) {
  return Object.values(useScene.getState().nodes).filter((node) => node.type === type)
}

function plate() {
  return nodesOfType('slab')[0] as SlabNode
}

function autoCeiling() {
  return nodesOfType('ceiling')[0] as CeilingNode
}

function room() {
  return nodesOfType('zone')[0] as ZoneNode
}

function moveRightWall(x: number) {
  useScene.getState().updateNodes([
    { id: 'wall_derived_guard_0', data: { end: [x, 0] } },
    { id: 'wall_derived_guard_1', data: { start: [x, 0], end: [x, 4] } },
    { id: 'wall_derived_guard_2', data: { start: [x, 4] } },
  ])
}

test('non-reconciler creates become manual slabs and ceilings at every store boundary', () => {
  openRoom()
  stopDetection()
  const scene = useScene.getState()
  const slab = SlabNode.parse({
    id: 'slab_forged',
    polygon,
    boundary: 'auto',
    zoneIds: ['zone_room'],
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_forged',
    polygon,
    autoFromWalls: true,
    zoneId: 'zone_room',
  })
  scene.createNode(slab, levelId)
  scene.createNodes([{ node: ceiling, parentId: levelId }])
  scene.applyNodeChanges({
    create: [{ node: { ...slab, id: 'slab_forged_batch' }, parentId: levelId }],
  })
  for (const id of [slab.id, ceiling.id, 'slab_forged_batch'] as AnyNodeId[]) {
    const node = useScene.getState().nodes[id] as unknown as {
      parentId: string
      polygon: unknown
      autoFromWalls: boolean
      boundary?: string
      zoneIds?: string[]
      zoneId?: string
    }
    expect(node).toMatchObject({ parentId: levelId, polygon, autoFromWalls: false })
    expect(node.boundary).toBeUndefined()
    expect(node.zoneIds).toBeUndefined()
    expect(node.zoneId).toBeUndefined()
  }
  expect(slab.boundary).toBe('auto')
})

test('reshaping, relinking and demoting derived construction is a no-op', () => {
  closeRoom()
  const scene = useScene.getState()
  const original = scene.nodes
  for (const surface of [plate(), autoCeiling()]) {
    scene.updateNode(surface.id, { polygon: [], parentId: buildingId })
    scene.updateNode(surface.id, { boundary: undefined, autoFromWalls: false })
    scene.updateNodes([{ id: surface.id, data: { polygon: [] } }])
    scene.applyNodeChanges({ update: [{ id: surface.id, data: { polygon: [] } }] })
  }
  scene.updateNode(plate().id, { zoneIds: [] })
  scene.updateNode(autoCeiling().id, { zoneId: 'zone_elsewhere' })
  expect(useScene.getState().nodes).toBe(original)
  scene.updateNode(plate().id, { polygon: [], materialPreset: 'oak' })
  expect(plate()).toMatchObject({
    polygon: (original[plate().id] as SlabNode).polygon,
  })
  expect(plate().materialPreset).toBeUndefined()
})

function plateWithRoomHole() {
  openRoom()
  stopDetection()
  const node = SlabNode.parse({
    id: 'slab_room_hole',
    parentId: levelId,
    polygon,
    boundary: 'auto',
    zoneIds: ['zone_room'],
    holes: [hole],
    holeMetadata: [{ source: 'room' }],
  })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [node.id]: node } })
  clearSceneHistory()
  return node
}

test('relabeling a room hole makes no store notification, commit or node object', () => {
  const node = plateWithRoomHole()
  const before = useScene.getState()
  let notifications = 0
  let commits = 0
  const stopStore = useScene.subscribe(() => notifications++)
  const stopCommits = subscribeSceneCommits(() => commits++)
  try {
    const data = { holes: [hole], holeMetadata: [{ source: 'manual' as const }] }
    before.updateNode(node.id, data)
    before.updateNodes([{ id: node.id, data }])
    before.applyNodeChanges({ update: [{ id: node.id, data }] })
    expect(useScene.getState()).toBe(before)
    expect(notifications).toBe(0)
    expect(commits).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    stopStore()
    stopCommits()
  }
})

test('manual derived-plate writes create opening intent, preserve room holes, and repeat writes are no-ops', () => {
  const node = plateWithRoomHole()
  const poolHole = hole.map(([x, z]): [number, number] => [x + 3, z])
  const data = {
    holes: [poolHole, hole],
    holeMetadata: [{ source: 'manual' as const }, { source: 'manual' as const }],
  }
  let commits = 0
  const stop = subscribeSceneCommits(() => commits++)
  try {
    useScene.getState().updateNode(node.id, data)
    const updated = useScene.getState().nodes[node.id] as SlabNode
    expect(updated.holes).toEqual([hole])
    expect(updated.holeMetadata).toEqual([{ source: 'room' }])
    expect(nodesOfType('floor-opening')).toEqual([
      expect.objectContaining({ polygon: poolHole, parentId: levelId, source: 'manual' }),
    ])
    expect(commits).toBe(1)
    useScene.getState().updateNode(node.id, data)
    expect(useScene.getState().nodes[node.id]).toBe(updated)
    expect(nodesOfType('floor-opening')).toHaveLength(1)
    expect(commits).toBe(1)
  } finally {
    stop()
  }
})

test('hole merging matches kernel precision, winding and start point and appends omitted rooms', () => {
  const node = plateWithRoomHole()
  const shifted = hole.map(([x, z]): [number, number] => [x + 0.00001, z - 0.00001]).reverse()
  shifted.push(shifted.shift()!)
  useScene.getState().updateNode(node.id, {
    holes: [shifted, hole],
    holeMetadata: [{ source: 'manual' }, { source: 'manual' }],
  })
  expect(useScene.getState().nodes[node.id]).toBe(node)
  useScene.getState().updateNode(node.id, { holeMetadata: [] })
  useScene.getState().updateNode(node.id, { holes: [], holeMetadata: [] })
  expect(useScene.getState().nodes[node.id]).toBe(node)
  const authored = hole.map(([x, z]): [number, number] => [x + 0.0002, z])
  useScene.getState().updateNode(node.id, {
    holes: [authored],
    holeMetadata: [{ source: 'stair', stairId: 'stair_opening' }],
  })
  expect(useScene.getState().nodes[node.id]).toMatchObject({
    holes: [authored, hole],
    holeMetadata: [{ source: 'stair', stairId: 'stair_opening' }, { source: 'room' }],
  })
})

test('the public SceneApi filters derived writes and preserves allowed edits', () => {
  closeRoom()
  const api = createSceneApi(useScene)
  const original = plate()
  api.update(original.id, { polygon: [] })
  api.upsert({ ...original, polygon: [] }, buildingId)
  api.applyChanges!({ update: [{ id: autoCeiling().id, data: { boundary: undefined } }] })
  expect(plate()).toBe(original)
  api.update(autoCeiling().id, { height: 2.2 })
  expect(autoCeiling().height).toBe(2.2)
})

test('the derived writer capability returns the original changes untouched', () => {
  const node = plateWithRoomHole()
  const changes = {
    create: [{ node }],
    update: [{ id: node.id, data: { polygon: [], holes: [] } }],
  }
  expect(
    filterDerivedNodeWrites({ [node.id]: node }, changes, { derivedWriter: DERIVED_WRITER_TOKEN }),
  ).toBe(changes)
})

test('warnings are once per node and field in dev and silent in tests and production', () => {
  const node = SlabNode.parse({ id: 'slab_warning', polygon, boundary: 'auto' })
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  const env = process.env.NODE_ENV
  const apply = (data: Partial<AnyNode>) =>
    filterDerivedNodeWrites({ [node.id]: node }, { update: [{ id: node.id, data }] })
  try {
    for (const mode of ['test', 'production']) {
      process.env.NODE_ENV = mode
      apply({ polygon: [] })
    }
    expect(warn).not.toHaveBeenCalled()
    process.env.NODE_ENV = 'development'
    apply({ polygon: [] })
    apply({ polygon: [] })
    apply({ polygon: [], boundary: undefined })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0]![0]).toContain('polygon on slab_warning')
    expect(warn.mock.calls[1]![0]).toContain('boundary on slab_warning')
  } finally {
    process.env.NODE_ENV = env
    warn.mockRestore()
  }
})

// ── Allowed ──────────────────────────────────────────────────────────────────

test('finish, ceiling height and hosted children stay editable on derived construction', () => {
  closeRoom()
  const scene = useScene.getState()
  scene.updateNode(autoCeiling().id, { height: 2.3, materialPreset: 'plaster' })
  scene.updateNode(plate().id, { slots: { edge: 'library:oak' } })
  expect(autoCeiling()).toMatchObject({ height: 2.3, materialPreset: 'plaster' })
  expect(plate()).toMatchObject({ slots: { edge: 'library:oak' } })

  const light = ItemNode.parse({
    id: 'item_pendant',
    parentId: autoCeiling().id,
    position: [4, 0, 2],
    asset: {
      id: 'room_light',
      name: 'Room light',
      category: 'lighting',
      thumbnail: '',
      src: '/room-light.glb',
      attachTo: 'ceiling',
    },
  })
  scene.createNode(light, autoCeiling().id)
  expect(autoCeiling().children).toContain(light.id)

  // Plate construction is authored intent the plate builder promotes into the
  // room's floor elevation, so it is not a derived write.
  useScene.getState().updateNode(plate().id, { thickness: 0.2 })
  expect(plate().thickness).toBe(0.2)
})

test('detachDerivedNode converts a plate and a ceiling into authored surfaces', () => {
  closeRoom()
  const edited: Array<[number, number]> = [
    [0, 0],
    [8.1, 0],
    [8.1, 4],
    [0, 4],
  ]
  const plateId = plate().id
  const ceilingId = autoCeiling().id
  useScene.getState().detachDerivedNode(plateId, { polygon: edited })
  useScene.getState().detachDerivedNode(ceilingId, { polygon: edited })
  for (const id of [plateId, ceilingId]) {
    const node = useScene.getState().nodes[id] as SlabNode | CeilingNode
    expect(node.polygon).toEqual(edited)
    expect(node.autoFromWalls).toBe(false)
    expect(node.boundary).toBeUndefined()
  }
  expect((useScene.getState().nodes[plateId] as SlabNode).zoneIds).toBeUndefined()
  expect((useScene.getState().nodes[ceilingId] as CeilingNode).zoneId).toBeUndefined()

  // Detached surfaces survive the next reconciliation untouched.
  moveRightWall(8.6)
  expect((useScene.getState().nodes[plateId] as SlabNode).polygon).toEqual(edited)
  expect((useScene.getState().nodes[ceilingId] as CeilingNode).polygon).toEqual(edited)
})

test('deleting a derived ceiling records hasCeiling and is not rebuilt', () => {
  closeRoom()
  const zoneId = room().id
  const ceilingId = autoCeiling().id
  useScene.getState().deleteNode(ceilingId)
  expect(useScene.getState().nodes[ceilingId]).toBeUndefined()
  expect(useScene.getState().nodes[zoneId]).toMatchObject({ hasCeiling: false })
  moveRightWall(8.3)
  expect(nodesOfType('ceiling')).toHaveLength(0)
})

test('deleting a derived plate records hasFloor and is not rebuilt', () => {
  closeRoom()
  const zoneId = room().id
  const plateId = plate().id
  useScene.getState().deleteNodes([plateId])
  expect(useScene.getState().nodes[plateId]).toBeUndefined()
  expect(useScene.getState().nodes[zoneId]).toMatchObject({ hasFloor: false })
  moveRightWall(8.3)
  expect(nodesOfType('slab')).toEqual([])
})

test('a cascading level deletion carries no room intent', () => {
  closeRoom()
  expect(() => useScene.getState().deleteNode(levelId)).not.toThrow()
  expect(nodesOfType('slab')).toHaveLength(0)
  expect(nodesOfType('ceiling')).toHaveLength(0)
  expect(nodesOfType('zone')).toHaveLength(0)
})

// ── Capability holders ───────────────────────────────────────────────────────

test('the reconciler still writes derived construction', () => {
  closeRoom()
  expect(plate()).toMatchObject({ boundary: 'auto', autoFromWalls: true })
  expect(autoCeiling()).toMatchObject({ boundary: 'auto', autoFromWalls: true })
  moveRightWall(9)
  expect(Math.max(...plate().polygon.map(([x]) => x))).toBeGreaterThan(8.5)
})

test('load migrations still mint derived construction from a legacy scene', () => {
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      id: `wall_legacy_${index}`,
      parentId: levelId,
      start,
      end: polygon[(index + 1) % 4],
      height: 2.5,
    }),
  )
  const legacySlab = SlabNode.parse({
    id: 'slab_legacy',
    parentId: levelId,
    polygon,
    autoFromWalls: true,
  })
  const legacyCeiling = CeilingNode.parse({
    id: 'ceiling_legacy',
    parentId: levelId,
    polygon,
    autoFromWalls: true,
  })
  const children = [...walls, legacySlab, legacyCeiling]
  const level = LevelNode.parse({
    id: levelId,
    parentId: buildingId,
    children: children.map((node) => node.id),
  })
  const building = BuildingNode.parse({ id: buildingId, children: [levelId] })
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, level, ...children].map((node) => [node.id, node])) as Record<
        AnyNodeId,
        AnyNode
      >,
      [buildingId],
    )
  clearSceneHistory()
  startDetection()
  expect(nodesOfType('zone')).toHaveLength(1)
  expect(plate()).toMatchObject({ boundary: 'auto', autoFromWalls: true })
  expect(autoCeiling()).toMatchObject({ boundary: 'auto', zoneId: room().id })
})

test('undo and redo restore derived construction', () => {
  const walls = openRoom()
  const before = useScene.getState().nodes
  useScene.getState().createNode(walls[3]!, levelId)
  const closed = useScene.getState().nodes
  expect(nodesOfType('slab')).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  useScene.temporal.getState().redo()
  expect(useScene.getState().nodes).toEqual(closed)
})

test('host patches apply derived construction minted by the originator', () => {
  const walls = openRoom()
  stopDetection()
  const derivedCeiling = CeilingNode.parse({
    id: 'ceiling_from_host',
    parentId: levelId,
    polygon,
    boundary: 'auto',
    autoFromWalls: true,
    zoneId: 'zone_from_host',
  })
  expect(
    applySceneOperationPatch({
      materialChanges: [],
      nodeCreates: [
        { node: walls[3]!, position: 3 },
        { node: derivedCeiling, position: 4 },
      ],
      nodeUpdates: [],
      nodeDeletes: [],
    }),
  ).toBe(true)
  expect(useScene.getState().nodes[derivedCeiling.id]).toMatchObject({ boundary: 'auto' })
})
