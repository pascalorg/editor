import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createZone, divideZone, setZoneIntent, structureChangeBatch } from '../commands/structure'
import { roomFace } from '../commands/structure/shared'
import { roomClearPolygon } from '../lib/level-footprints'
import {
  computePlateSurfacePartition,
  plateLevelContext,
  roomFinishRole,
} from '../lib/plate-surface'
import { area, difference, type Ring, union } from '../lib/polygon-boolean'
import { createRoomTopologyIndex, initSpaceDetectionSync } from '../lib/space-detection'
import { BuildingNode, LevelNode, WallNode, type ZoneNode } from '../schema'
import useScene, { clearSceneHistory } from './use-scene'

const rectangle: Ring = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]
const concave: Ring = [
  [0, 0],
  [6, 0],
  [6, 2],
  [3, 2],
  [3, 5],
  [0, 5],
]
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let stop = () => {}
let previous: ReturnType<typeof useScene.getState>
let sequence = 0
const mintId = (kind: string) => `${kind}_floor_probe_${sequence++}`
const levelId = 'level_floor_probe'
beforeEach(() => {
  previous = useScene.getState()
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  const level = LevelNode.parse({ id: levelId, parentId: 'building_floor_probe', height: 3 })
  const building = BuildingNode.parse({ id: 'building_floor_probe', children: [level.id] })
  useScene.setState({
    nodes: { [level.id]: level, [building.id]: building },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  clearSceneHistory()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
})
afterEach(() => {
  stop()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
  useScene.setState(previous, true)
  clearSceneHistory()
})

function assertRoomTops(count: number, paint = true) {
  const nodes = useScene.getState().nodes
  const context = plateLevelContext(nodes[levelId]!, (id) => nodes[id])
  const topology = createRoomTopologyIndex()
  topology.rebuild(nodes)
  const zones = context.zones.filter((zone) => zone.spaceRole === 'room')
  expect(zones).toHaveLength(count)
  for (const zone of zones) {
    expect(zone.hasFloor).not.toBe(false)
    const plates = context.slabs.filter(
      (slab) => slab.boundary === 'auto' && slab.zoneIds?.includes(zone.id),
    )
    expect(plates.length).toBeGreaterThan(0)
    const face = roomFace(nodes, zone)!
    expect(face).toBeDefined()
    const clear = roomClearPolygon(
      topology.getLevelTopology(levelId)!.rooms.find((room) => room.id === face.id)!,
    )
    expect(area(clear)).toBeGreaterThan(1)
    expect(
      area(
        difference(
          clear,
          union(plates.map((plate) => ({ outer: plate.polygon, holes: plate.holes }))),
        ),
      ),
    ).toBeLessThan(1e-6)
    const cells = plates.flatMap((plate) => {
      const partition = computePlateSurfacePartition(plate, context)
      expect(partition).not.toBeNull()
      expect(area(partition!.masked)).toBe(0)
      return partition!.cells
    })
    expect(area(difference(clear, union(cells.flatMap((cell) => cell.polygons))))).toBeLessThan(
      1e-6,
    )
    if (zone.floor?.finish)
      expect(cells.some((cell) => cell.role === roomFinishRole(zone.id))).toBe(true)
  }
  if (paint) {
    for (const zone of zones)
      useScene.getState().applyNodeChanges(
        structureChangeBatch(
          setZoneIntent(useScene.getState().nodes, {
            zoneId: zone.id,
            patch: { floor: { finish: 'library:wood-woodplank48' } },
          }).changes,
        ),
      )
    assertRoomTops(count, false)
  }
}

function create(polygon: Ring, enclose: boolean) {
  const plan = createZone(useScene.getState().nodes, { levelId, polygon, enclose, mintId })
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  return plan.zoneId as ZoneNode['id']
}

for (const reverse of [false, true]) {
  test(`L-shaped wall room has a plate and complete top cells (reversed=${reverse})`, () => {
    const points = reverse ? [...concave].reverse() : concave
    for (const [i, start] of points.entries()) {
      useScene.getState().createNode(
        WallNode.parse({
          id: mintId('wall'),
          parentId: levelId,
          start,
          end: points[(i + 1) % points.length],
        }),
        levelId,
      )
    }
    assertRoomTops(1)
  })
}

test('separator Divide gives both halves plate membership and complete top cells', () => {
  const zoneId = create(rectangle, true)
  const plan = divideZone(useScene.getState().nodes, {
    zoneId,
    cut: [
      [3, 0],
      [3, 4],
    ],
    mintId,
  })
  expect(plan.conflicts).toBeUndefined()
  useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
  assertRoomTops(2)
})

test('createZone enclose produces a plate and complete top cells', () => {
  create(concave, true)
  assertRoomTops(1)
})

test('separator-only terrace produces a plate and complete top cells', () => {
  create(concave, false)
  assertRoomTops(1)
})

test('adjacent concave, divided and separator-only rooms retain complete plate tops together', () => {
  create(concave, true)
  const next = rectangle.map(([x, z]): [number, number] => [x + 6, z])
  const divided = create(next, true)
  const division = divideZone(useScene.getState().nodes, {
    zoneId: divided,
    cut: [
      [9, 0],
      [9, 4],
    ],
    mintId,
  })
  expect(division.conflicts).toBeUndefined()
  useScene.getState().applyNodeChanges(structureChangeBatch(division.changes))
  create(
    rectangle.map(([x, z]): [number, number] => [x + 12, z]),
    false,
  )
  assertRoomTops(4)
})
