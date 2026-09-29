import { afterEach, expect, test } from 'bun:test'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import {
  type AnyNode,
  CeilingNode,
  FloorOpeningNode,
  LevelNode,
  SlabNode,
  StairNode,
  WallNode,
  ZoneNode,
} from '../schema'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { alignLegacyStairCuts } from './reconcile-structure-on-load'
import {
  createStructureIdFactory,
  migrateCeilingRoomLinks,
  migrateRoomZones,
  reconcileStructureOnLoad,
} from './scene-migrations'

function room(suffix = 'load', hasCeiling = true) {
  const polygon: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const level = LevelNode.parse({ id: `level_${suffix}`, height: 3 })
  const walls = polygon.map((start, i) =>
    WallNode.parse({
      id: `wall_${suffix}_${i}`,
      parentId: level.id,
      start,
      end: polygon[(i + 1) % 4],
    }),
  )
  // A room the editor drew (seed and boundaries set) whose construction is still missing.
  const zone = ZoneNode.parse({
    id: `zone_${suffix}`,
    parentId: level.id,
    polygon,
    name: 'Room',
    spaceRole: 'room',
    autoFromWalls: true,
    seed: [2, 2],
    boundaryWallIds: walls.map((wall) => wall.id).sort(),
    ...(hasCeiling ? {} : { hasCeiling: false }),
  })
  level.children = [...walls.map((wall) => wall.id), zone.id]
  return Object.fromEntries([level, ...walls, zone].map((node) => [node.id, node]))
}
function surfaces(nodes: Record<string, AnyNode>) {
  return Object.values(nodes).filter((node) => node.type === 'slab' || node.type === 'ceiling')
}
const previous = useScene.getState()
afterEach(() => {
  useScene.setState(previous, true)
  clearSceneHistory()
})

test('load creates missing plate and ceiling purely, deterministically and idempotently', () => {
  const nodes = room(),
    snapshot = structuredClone(nodes)
  const first = reconcileStructureOnLoad(nodes)
  expect(first.changed).toBe(true)
  expect(nodes).toEqual(snapshot)
  expect(
    surfaces(first.nodes)
      .map((node) => node.type)
      .sort(),
  ).toEqual(['ceiling', 'slab'])
  expect(reconcileStructureOnLoad(first.nodes)).toEqual({ nodes: first.nodes, changed: false })
  expect(reconcileStructureOnLoad(first.nodes).nodes).toBe(first.nodes)
  expect(
    reconcileStructureOnLoad(Object.fromEntries(Object.entries(nodes).reverse())).nodes,
  ).toEqual(first.nodes)
  for (const surface of surfaces(first.nodes))
    expect((first.nodes.level_load as LevelNode).children).toContain(surface.id)
})

test('a scene saved after editor reconciliation is an identity no-op on load', () => {
  let id = 0
  const saved = reconcileSceneStructure({
    nodes: room(),
    mintId: (kind) => `${kind}_editor_${id++}`,
  }).nodes
  expect(reconcileStructureOnLoad(saved)).toEqual({ nodes: saved, changed: false })
  expect(reconcileStructureOnLoad(saved).nodes).toBe(saved)
})

test('load respects hasCeiling false and hasFloor false', () => {
  const nodes = room('disabled', false)
  expect(surfaces(reconcileStructureOnLoad(nodes).nodes).map((n) => n.type)).toEqual(['slab'])
  nodes.zone_disabled = { ...nodes.zone_disabled, hasFloor: false } as ZoneNode
  expect(surfaces(reconcileStructureOnLoad(nodes).nodes)).toEqual([])
})

test('legacy rooms without a saved ceiling stay ceilingless beside a room with one', () => {
  // A main-era level: two rooms, a ceiling drawn over one of them only.
  const level = LevelNode.parse({ id: 'level_partial', height: 3 })
  const ring: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const walls = [
    ...ring.map((start, i) =>
      WallNode.parse({
        id: `wall_partial_${i}`,
        parentId: level.id,
        start,
        end: ring[(i + 1) % 4],
      }),
    ),
    WallNode.parse({ id: 'wall_partial_divider', parentId: level.id, start: [2, 0], end: [2, 4] }),
  ]
  const ceiling = CeilingNode.parse({
    id: 'ceiling_partial',
    parentId: level.id,
    autoFromWalls: true,
    polygon: [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
    ],
  })
  level.children = [...walls.map((wall) => wall.id), ceiling.id]
  const legacy = Object.fromEntries([level, ...walls, ceiling].map((node) => [node.id, node]))
  const load = (nodes: Record<string, unknown>) =>
    reconcileStructureOnLoad(migrateCeilingRoomLinks(migrateRoomZones(nodes).nodes).nodes, nodes)
      .nodes as Record<string, AnyNode>
  const loaded = load(legacy)
  const ceilings = Object.values(loaded).filter((node) => node.type === 'ceiling')
  expect(ceilings.map((node) => node.id)).toEqual(['ceiling_partial'])
  const rooms = Object.values(loaded).filter((node): node is ZoneNode => node.type === 'zone')
  expect(rooms.map((room) => room.hasCeiling).sort()).toEqual([false, undefined])
  expect(rooms.find((room) => room.hasCeiling === false)!.id).not.toBe(
    (ceilings[0] as CeilingNode).zoneId,
  )
  expect(load(loaded)).toEqual(loaded)
})

test('load keeps a saved ceiling height the kernel would clamp, and reloads unchanged', () => {
  const nodes: Record<string, AnyNode> = room('tall')
  const ceiling = CeilingNode.parse({
    id: 'ceiling_tall',
    parentId: 'level_tall',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    height: 5,
  })
  nodes[ceiling.id] = ceiling
  ;(nodes.level_tall as LevelNode).children.push(ceiling.id)
  const loaded = reconcileStructureOnLoad(nodes).nodes
  expect((loaded.ceiling_tall as CeilingNode).height).toBe(5)
  expect(reconcileStructureOnLoad(loaded).nodes).toBe(loaded)
})

test('load IDs depend on owning boundaries, not unrelated levels or node insertion order', () => {
  const alone = reconcileStructureOnLoad(room()).nodes
  const combined = reconcileStructureOnLoad({ ...room('elsewhere'), ...room() }).nodes
  expect(
    surfaces(combined)
      .filter((n) => n.parentId === 'level_load')
      .map((n) => n.id)
      .sort(),
  ).toEqual(
    surfaces(alone)
      .map((n) => n.id)
      .sort(),
  )
})

test('shared FNV structure IDs sort UTF-8 boundaries and skip existing and minted IDs', () => {
  const first = createStructureIdFactory({})('ceiling', ['wall_é', 'separator_a'])
  expect(createStructureIdFactory({})('ceiling', ['separator_a', 'wall_é'])).toBe(first)
  const mint = createStructureIdFactory({ [first]: {} })
  const second = mint('ceiling', ['wall_é', 'separator_a'])
  expect(second).not.toBe(first)
  expect(mint('ceiling', ['wall_é', 'separator_a'])).not.toBe(second)
})

test('client hydration creates the same missing construction as the shared final migration', async () => {
  const nodes = room()
  const expected = reconcileStructureOnLoad(nodes)
  useScene.getState().setScene(nodes, ['level_load'])
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(surfaces(useScene.getState().nodes)).toEqual(surfaces(expected.nodes))
  expect(reconcileStructureOnLoad(useScene.getState().nodes).changed).toBe(false)
})

test('load drops an orphan stair hole instead of turning it into a manual opening', () => {
  const saved = reconcileStructureOnLoad(room()).nodes
  const plate = surfaces(saved).find((node) => node.type === 'slab')!
  const hole: [number, number][] = [
    [-1.123_456_789, 1],
    [2, 1],
    [2, 2],
    [-1.123_456_789, 2],
  ]
  const nodes = {
    ...saved,
    [plate.id]: {
      ...plate,
      holes: [hole],
      holeMetadata: [{ source: 'stair', stairId: 'stair_saved' }],
    },
  }
  const loaded = reconcileStructureOnLoad(nodes)
  const migratedPlate = loaded.nodes[plate.id]
  expect(migratedPlate?.type).toBe('slab')
  if (migratedPlate?.type !== 'slab') return
  expect(migratedPlate.holes).toEqual([])
  expect(migratedPlate.holeMetadata).toEqual([])
  expect(Object.values(loaded.nodes).filter((node) => node.type === 'floor-opening')).toEqual([])
  expect(reconcileStructureOnLoad(loaded.nodes).nodes).toBe(loaded.nodes)
})

test('a legacy stair cut in a shared stairwell snaps to the ceiling hole its sibling stair recorded', () => {
  const stairA = StairNode.parse({ id: 'stair_a', fromLevelId: 'level_0', toLevelId: 'level_1' })
  const stairB = StairNode.parse({ id: 'stair_b', fromLevelId: 'level_0', toLevelId: 'level_1' })
  const ceilingHole: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 4],
    [0, 4],
  ]
  const nearlyShared: [number, number][] = [
    [0.1, 0],
    [2.1, 0],
    [2.1, 4],
    [0.1, 4],
  ]
  const elsewhere: [number, number][] = [
    [5, 5],
    [6, 5],
    [6, 6],
    [5, 6],
  ]
  const first = FloorOpeningNode.parse({
    id: 'floor-opening_a',
    parentId: 'level_1',
    source: 'stair',
    ownerId: stairA.id,
    polygon: ceilingHole,
    legacyCeilingCuts: { ceiling_0: [ceilingHole] },
  })
  const second = FloorOpeningNode.parse({
    id: 'floor-opening_b',
    parentId: 'level_1',
    source: 'stair',
    ownerId: stairB.id,
    polygon: nearlyShared,
    legacyPlateCuts: { slab_1: [nearlyShared, elsewhere] },
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [stairA, stairB, first, second].map((node) => [node.id, node]),
  )
  const aligned = alignLegacyStairCuts(nodes)
  expect(aligned[second.id]).toMatchObject({
    legacyPlateCuts: { slab_1: [ceilingHole, elsewhere] },
  })
  expect(aligned[first.id]).toBe(first)
  expect(nodes[second.id]).toBe(second)
  expect(alignLegacyStairCuts(aligned)).toBe(aligned)
  // A stair to a different level is not in the same stairwell.
  const unrelated = { ...nodes, [stairA.id]: { ...stairA, toLevelId: 'level_2' } }
  expect(alignLegacyStairCuts(unrelated)).toBe(unrelated)
})

test('new room IDs are remapped through grouped plates and ceilings in one load', () => {
  const nodes: Record<string, AnyNode> = room()
  delete nodes.zone_load
  const divider = WallNode.parse({
    id: 'wall_divider',
    parentId: 'level_load',
    start: [2, 0],
    end: [2, 4],
  })
  nodes[divider.id] = divider
  const first = reconcileStructureOnLoad(nodes)
  const zones = Object.values(first.nodes).filter((node) => node.type === 'zone')
  const plates = Object.values(first.nodes).filter((node) => node.type === 'slab')
  expect(zones).toHaveLength(2)
  expect(plates).toHaveLength(1)
  expect(plates[0]!.zoneIds).toEqual(zones.map((zone) => zone.id).sort())
  for (const ceiling of surfaces(first.nodes).filter((node) => node.type === 'ceiling')) {
    expect(zones.map((zone) => zone.id)).toContain(ceiling.zoneId)
  }
  expect(reconcileStructureOnLoad(first.nodes).nodes).toBe(first.nodes)
})

test('load preserves legacy recessed slabs while filling missing ceilings', () => {
  const nodes: Record<string, AnyNode> = room()
  const slab = SlabNode.parse({
    id: 'slab_pool',
    parentId: 'level_load',
    autoFromWalls: true,
    recessed: true,
    polygon: (nodes.zone_load as ZoneNode).polygon,
  })
  nodes[slab.id] = slab
  const first = reconcileStructureOnLoad(nodes)
  expect(first.nodes[slab.id]).toEqual({ ...slab, autoFromWalls: false })
  // The recess is the room's floor: no generated wall ring stacks around it.
  expect(
    surfaces(first.nodes)
      .map((node) => node.type)
      .sort(),
  ).toEqual(['ceiling', 'slab'])
  expect(reconcileStructureOnLoad(first.nodes).nodes).toBe(first.nodes)
})
