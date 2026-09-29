import { expect, test } from 'bun:test'
import { getOpeningFloorDatum, getOpeningFloorTarget } from '../lib/opening-floor-datum'
import { checkRoomFloor } from '../lib/room-floor-feasibility'
import {
  type AnyNode,
  DoorNode,
  LevelNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { legacyOpeningFloorChange } from './legacy-opening-datums'

function fixture(raised: boolean) {
  const polygon: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  const level = LevelNode.parse({ id: 'level_test' })
  const walls = polygon.map((start, i) =>
    WallNode.parse({
      id: `wall_${i}`,
      parentId: level.id,
      start,
      end: polygon[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const wall = WallNode.parse({
    id: 'wall_shared',
    parentId: level.id,
    start: [2, 0],
    end: [2, 4],
    thickness: 0.2,
  })
  const door = DoorNode.parse({ parentId: wall.id, position: [2, 1, 0], height: 2, width: 0.8 })
  wall.children = [door.id]
  const left = ZoneNode.parse({
    id: 'zone_left',
    name: 'Left',
    parentId: level.id,
    spaceRole: 'room',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
    ],
    floor: { elevation: 0.05 },
  })
  const right = ZoneNode.parse({
    id: 'zone_right',
    name: 'Right',
    parentId: level.id,
    spaceRole: 'room',
    polygon: [
      [2, 0],
      [4, 0],
      [4, 4],
      [2, 4],
    ],
    floor: { elevation: raised ? 0.35 : 0.05 },
  })
  const base = SlabNode.parse({
    id: 'slab_base',
    parentId: level.id,
    polygon: [
      [-0.1, -0.1],
      [4.1, -0.1],
      [4.1, 4.1],
      [-0.1, 4.1],
    ],
    boundary: 'auto',
    plateRole: 'base',
    elevation: 0.05,
    zoneIds: [left.id, right.id],
  })
  const platform = SlabNode.parse({
    id: 'slab_platform',
    parentId: level.id,
    polygon: right.polygon,
    boundary: 'auto',
    plateRole: 'platform',
    elevation: 0.35,
    thickness: 0.3,
    zoneIds: [right.id],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...walls, wall, door, left, right, base, ...(raised ? [platform] : [])].map((node) => [
      node.id,
      node,
    ]),
  )
  return { nodes, wall, door }
}

test('a legacy opening may follow a real step but not a support shift larger than that step', () => {
  const { nodes, wall, door } = fixture(true)
  expect(legacyOpeningFloorChange(wall, door, nodes, 0.05)).toMatchObject({
    reason: 'between-heights',
  })
  expect(legacyOpeningFloorChange(wall, door, nodes, -0.05).reason).toBeUndefined()
})

test('an equal-floor correction requires a finish that already covered the legacy opening', () => {
  const { nodes, wall, door } = fixture(false)
  expect(legacyOpeningFloorChange(wall, door, nodes, 0).reason).toBeUndefined()
  expect(legacyOpeningFloorChange(wall, door, nodes, 0, 1e-6, 0.05).reason).toBe('finished-floor')
})

test('a higher-floor opening must fit in both migration and live placement, including exact clearance', () => {
  const source = fixture(true)
  for (const opening of [
    source.door,
    WindowNode.parse({ ...source.door, id: 'window_fit', type: 'window', openingKind: 'window' }),
  ]) {
    for (const height of [undefined, 2.3, 2.299]) {
      const wall = { ...source.wall, height, children: [opening.id] }
      const nodes = { ...source.nodes, [wall.id]: wall, [opening.id]: opening }
      const fits = height !== 2.299
      expect(getOpeningFloorTarget(wall, opening, nodes)).toBeCloseTo(0.35)
      expect(getOpeningFloorDatum(wall, opening, nodes)).toBeCloseTo(fits ? 0.35 : 0.05)
      const migration = legacyOpeningFloorChange(wall, opening, nodes, 0.05)
      expect(migration.fits).toBe(fits)
      expect(migration.reason).toBe(fits ? 'between-heights' : undefined)
      if (!fits)
        expect(checkRoomFloor(nodes, 'zone_right', 0.35).conflicts).toContainEqual(
          expect.objectContaining({ code: 'floor-opening-fit' }),
        )
    }
  }
})
