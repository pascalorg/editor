import { expect, test } from 'bun:test'
import { AnyNode } from '../types'
import { CeilingNode } from './ceiling'
import { SlabNode } from './slab'
import { ZoneNode } from './zone'

const polygon = [
  [0, 0],
  [4, 0],
  [4, 3],
]

test('room intent fields stay sparse while boundary arrays and holes have defaults', () => {
  const zone = ZoneNode.parse({ name: 'Room', polygon })
  expect(zone.boundaryWallIds).toEqual([])
  expect(zone.boundarySeparatorIds).toEqual([])
  expect(zone.holes).toEqual([])
  for (const key of ['seed', 'floor', 'wallMaterial', 'wallOverrides', 'hasFloor', 'hasCeiling'])
    expect(Object.hasOwn(zone, key)).toBe(false)
  expect(ZoneNode.parse({ name: 'Room', polygon, floor: {} }).floor).toEqual({})
  for (const key of ['hasFloor', 'hasCeiling'])
    expect(ZoneNode.safeParse({ name: 'Room', polygon, [key]: true }).success).toBe(false)
})

test('room fields round-trip through the node union without changing documentation strings', () => {
  const fields = {
    seed: [1, 1],
    floor: {
      elevation: -0.2,
      finish: 'library:oak',
      regions: [{ id: 'region_a', polygon, finish: 'scene:tile' }],
    },
    wallMaterial: 'scene:paint',
    wallOverrides: [
      { wallId: 'wall_a', face: 'a', finish: 'library:paper' },
      { wallId: 'wall_b', face: 'b', finish: 'scene:paint' },
    ],
    hasFloor: false,
    hasCeiling: false,
    boundarySeparatorIds: ['separator_a'],
    holes: [polygon],
    floorFinish: 'Timber',
    wallFinish: 'Paint',
    ceilingFinish: 'ACT',
    ceilingHeight: 3.2,
  }
  const zone = ZoneNode.parse({ name: 'Room', polygon, ...fields })
  expect(zone).toMatchObject(fields)
  expect(AnyNode.parse(zone)).toEqual(zone)
})

test('ceiling and slab links stay sparse and round-trip through the node union', () => {
  for (const schema of [CeilingNode, SlabNode]) {
    const node = schema.parse({ polygon })
    for (const key of ['boundary', 'zoneId', 'zoneIds'])
      expect(Object.hasOwn(node, key)).toBe(false)
    expect(schema.safeParse({ polygon, boundary: 'manual' }).success).toBe(false)
  }
  const ceiling = CeilingNode.parse({ polygon, zoneId: 'zone_room', boundary: 'auto' })
  const slab = SlabNode.parse({
    polygon,
    zoneIds: ['zone_room'],
    boundary: 'auto',
    slots: {
      surface: 'library:wood',
      side: '#aaa',
      edge: '#bbb',
      riser: '#ccc',
      underside: '#ddd',
    },
  })
  expect(AnyNode.parse(ceiling)).toEqual(ceiling)
  expect(AnyNode.parse(slab)).toEqual(slab)
})
