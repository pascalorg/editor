import { expect, test } from 'bun:test'
import { createZone, divideZone, structureChangeBatch } from '../commands/structure'
import { type AnyNode, type AnyNodeId, CeilingNode, LevelNode, WallNode, ZoneNode } from '../schema'
import { subscribeSceneCommits } from '../store/history-control'
import useScene, {
  applySceneOperationPatch,
  clearSceneHistory,
  type SceneOperationPatch,
} from '../store/use-scene'
import { migrateFloorPlates } from '../utils/floor-plate-migration'
import { migrateCeilingRoomLinks, migrateRoomZones } from '../utils/room-zone-migration'
import { buildFloorPlates } from './floor-plates'
import { initSpaceDetectionSync } from './space-detection'
import { applyStructureReconciliation } from './structure-commit'
import { type NodePatch, reconcileLevelStructure, type SceneNodes } from './structure-kernel'
import { reconcileSceneStructure } from './structure-reconcile'

const levelId = 'level_json'
const polygon: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
function fixture() {
  const walls = polygon.map((start, i) =>
    WallNode.parse({
      id: `wall_json_${i}`,
      parentId: levelId,
      start,
      end: polygon[(i + 1) % polygon.length],
      thickness: 0.2,
    }),
  )
  const level = LevelNode.parse({ id: levelId, children: walls.map((wall) => wall.id) })
  return Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
}
function idFactory() {
  let i = 0
  return (kind: string) => `${kind}_json_${++i}`
}
function expectJsonKeys(value: unknown) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    expect(child, `undefined at ${key}`).not.toBeUndefined()
    expectJsonKeys(child)
  }
}
function expectCleanPatches(patches: NodePatch[]) {
  for (const patch of patches) {
    if (patch.op === 'create') expectJsonKeys(patch.node)
    if (patch.op === 'update') expectJsonKeys(patch.data)
  }
}

test('close and Divide planners emit JSON-clean zones, ceilings, plates and updates', () => {
  const nodes = fixture()
  const mintId = idFactory()
  const close = reconcileLevelStructure({ levelId, nodes, mintId })
  expect(
    close.patches
      .filter((p) => p.op === 'create')
      .map((p) => p.node.type)
      .sort(),
  ).toEqual(['ceiling', 'slab', 'zone'])
  expectCleanPatches(close.patches)
  const initial = reconcileSceneStructure({ nodes, mintId })
  expectCleanPatches(initial.patches)
  expectJsonKeys(initial.nodes)
  const zone = Object.values(initial.nodes).find((node) => node.type === 'zone')!
  const division = divideZone(initial.nodes, {
    zoneId: zone.id,
    cut: [
      [2, 0],
      [2, 4],
    ],
    mintId,
  })
  expect(division.conflicts).toBeUndefined()
  expectCleanPatches(division.changes)
  const separator = division.changes.find((patch) => patch.op === 'create')!.node
  const divided = reconcileSceneStructure({
    nodes: { ...initial.nodes, [separator.id]: separator },
    mintId,
  })
  expectCleanPatches(divided.patches)
  expect(divided.patches.some((p) => p.op === 'update')).toBe(true)
  expectJsonKeys(divided.nodes)
  expect(Object.values(divided.nodes).filter((node) => node.type === 'zone')).toHaveLength(2)
  expect(Object.values(divided.nodes).filter((node) => node.type === 'ceiling')).toHaveLength(2)
})

test('authored create planner strips absent intent fields before emitting a node', () => {
  const level = LevelNode.parse({ id: levelId })
  const plan = createZone(
    { [level.id]: level },
    {
      levelId,
      polygon,
      mintId: idFactory(),
      intent: { floor: null, wallMaterial: null, hasFloor: true, hasCeiling: true },
    },
  )
  expectCleanPatches(plan.changes)
})

test('plate builder cleans inherited optional and nested material keys without mutating its source', () => {
  const nodes = fixture()
  const mintId = idFactory()
  const result = reconcileSceneStructure({ nodes, mintId })
  const snapshot = reconcileLevelStructure({ nodes: result.nodes, levelId, mintId }).snapshot
  const source = Object.values(result.nodes).find((node) => node.type === 'slab')!
  const template = {
    ...source,
    material: undefined,
    slots: undefined,
    metadata: { absent: undefined, keep: false },
  }
  const plan = buildFloorPlates({
    levelId,
    rooms: snapshot.rooms.map((room) => ({
      ...room,
      id: room.zoneId,
      zone: result.nodes[room.zoneId] as ZoneNode,
      context: { revision: 0, walls: new Map(), wallFootprints: new Map() },
    })),
    slabs: [template],
    mintId: () => mintId('slab'),
  })
  expect(plan.plates).toHaveLength(1)
  expectJsonKeys(plan.plates)
  expect(plan.plates[0]!.metadata).toEqual({ keep: false })
  expect(Object.hasOwn(template, 'material')).toBe(true)
  expect(Object.hasOwn(template.metadata, 'absent')).toBe(true)
})

test('room, ceiling and floor migrations emit JSON-clean created and adopted nodes', () => {
  const nodes = fixture()
  const generic = ZoneNode.parse({
    id: 'zone_json_legacy',
    parentId: levelId,
    name: 'Kitchen',
    polygon,
    floor: { finish: undefined, elevation: 0.05 },
    wallMaterial: undefined,
    hasFloor: undefined,
    hasCeiling: undefined,
  })
  const source = { ...nodes, [generic.id]: generic }
  const rooms = migrateRoomZones(source)
  expect(rooms.adoptedZoneIds).toEqual([generic.id])
  expectJsonKeys(rooms.nodes[generic.id])
  expectJsonKeys(migrateRoomZones(nodes).nodes)
  const ceiling = CeilingNode.parse({
    id: 'ceiling_json_legacy',
    parentId: levelId,
    polygon,
    autoFromWalls: true,
    material: undefined,
    materialPreset: undefined,
    slots: undefined,
  })
  const linked = migrateCeilingRoomLinks({ ...rooms.nodes, [ceiling.id]: ceiling })
  expect(linked.linkedCeilingIds).toEqual([ceiling.id])
  expectJsonKeys(linked.nodes[ceiling.id])
  const closed = reconcileSceneStructure({ nodes, mintId: idFactory() }).nodes
  const plate = Object.values(closed).find((node) => node.type === 'slab')!
  const { boundary: _, plateRole: _role, ...legacy } = plate
  const plates = migrateFloorPlates({
    ...closed,
    [plate.id]: { ...legacy, material: undefined, materialPreset: undefined },
  })
  expect(plates.plateIds).toHaveLength(1)
  expectJsonKeys(plates.nodes)
  expect(Object.hasOwn(generic, 'wallMaterial')).toBe(true)
})

function compensation(before: SceneNodes, after: SceneNodes): SceneOperationPatch {
  const placements = (nodes: SceneNodes, other: SceneNodes) =>
    Object.values(nodes)
      .filter((node) => !other[node.id])
      .map((node) => ({
        node,
        position: (nodes[node.parentId!] as { children: AnyNodeId[] }).children.indexOf(node.id),
      }))
  return JSON.parse(
    JSON.stringify({
      materialChanges: [],
      nodeCreates: placements(after, before),
      nodeDeletes: placements(before, after),
      nodeUpdates: Object.values(after).flatMap((node) => {
        const previous = before[node.id]
        if (!previous) return []
        const data: Record<string, unknown> = {}
        const removeFields: string[] = []
        for (const key of new Set([...Object.keys(previous), ...Object.keys(node)])) {
          if (key === 'children') continue
          if (!Object.hasOwn(node, key)) removeFields.push(key)
          else if (
            JSON.stringify(previous[key as keyof AnyNode]) !==
            JSON.stringify(node[key as keyof AnyNode])
          )
            data[key] = node[key as keyof AnyNode]
        }
        return Object.keys(data).length || removeFields.length
          ? [{ id: node.id, data, removeFields }]
          : []
      }),
    }),
  )
}

for (const legacyUndefined of [false, true]) {
  test(`JSON-recorded Divide compensation undoes and redoes with legacy undefined=${legacyUndefined}`, () => {
    globalThis.requestAnimationFrame ??= (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame ??= () => {}
    const previous = useScene.getState()
    useScene.setState({
      nodes: fixture(),
      rootNodeIds: [levelId],
      collections: {},
      materials: {},
      readOnly: false,
    })
    clearSceneHistory()
    const mintId = idFactory()
    applyStructureReconciliation(useScene, { mintId })
    const before = useScene.getState().nodes
    expectJsonKeys(before)
    const zone = Object.values(before).find((node) => node.type === 'zone')!
    const stop = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    const origins: string[] = []
    const unsubscribe = subscribeSceneCommits((commit) => origins.push(commit.origin))
    try {
      clearSceneHistory()
      const division = divideZone(before, {
        zoneId: zone.id,
        cut: [
          [2, 0],
          [2, 4],
        ],
        mintId,
      })
      useScene.getState().applyNodeChanges(structureChangeBatch(division.changes))
      const after = useScene.getState().nodes
      expectJsonKeys(after)
      expect(origins).toEqual(['local'])
      const undo = compensation(after, before)
      const redo = compensation(before, after)
      if (legacyUndefined) {
        const dirty = { ...after }
        for (const { node } of undo.nodeDeletes) {
          if (node.type === 'zone')
            dirty[node.id] = {
              ...node,
              floor: undefined,
              wallMaterial: undefined,
              hasFloor: undefined,
              hasCeiling: undefined,
            }
          if (node.type === 'ceiling')
            dirty[node.id] = {
              ...node,
              material: undefined,
              materialPreset: undefined,
              slots: undefined,
            }
        }
        useScene.setState({ nodes: dirty })
      }
      expect(applySceneOperationPatch(undo)).toBe(true)
      expect(useScene.getState().nodes).toEqual(before)
      expect(applySceneOperationPatch(redo)).toBe(true)
      expect(useScene.getState().nodes).toEqual(after)
      expect(origins.slice(-2)).toEqual(['host', 'host'])
    } finally {
      unsubscribe()
      stop()
      useScene.setState(previous)
      clearSceneHistory()
    }
  })
}

test('compensation ignores undefined object keys on either side, recursively, but rejects real differences', () => {
  const previous = useScene.getState()
  const node = ZoneNode.parse({
    id: 'zone_json_equal',
    name: 'Room',
    polygon,
    metadata: { nested: [{ keep: null }] },
  })
  const recorded = JSON.parse(JSON.stringify(node)) as ZoneNode
  try {
    for (const recordedUndefined of [false, true]) {
      const extra = {
        ...node,
        floor: undefined,
        metadata: { nested: [{ keep: null, absent: undefined }] },
      }
      useScene.setState({
        nodes: { [node.id]: recordedUndefined ? recorded : extra },
        rootNodeIds: [node.id],
      })
      clearSceneHistory()
      expect(
        applySceneOperationPatch({
          nodeCreates: [],
          nodeUpdates: [],
          materialChanges: [],
          nodeDeletes: [{ node: recordedUndefined ? extra : recorded, position: 0 }],
        }),
      ).toBe(true)
    }
    for (const metadata of [
      { nested: [{ keep: false }] },
      { nested: [{}] },
      { nested: [{ keep: null }, {}] },
    ]) {
      useScene.setState({ nodes: { [node.id]: { ...node, metadata } }, rootNodeIds: [node.id] })
      clearSceneHistory()
      expect(
        applySceneOperationPatch({
          nodeCreates: [],
          nodeUpdates: [],
          materialChanges: [],
          nodeDeletes: [{ node: recorded, position: 0 }],
        }),
      ).toBe(false)
      expect(useScene.getState().nodes[node.id as AnyNodeId]).toBeDefined()
    }
  } finally {
    useScene.setState(previous)
    clearSceneHistory()
  }
})
