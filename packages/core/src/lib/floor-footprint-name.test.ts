import { expect, test } from 'bun:test'
import { type AnyNode, SlabNode, ZoneNode } from '../schema'
import { floorFootprintName } from './floor-footprint-name'

const square = (x: number, size: number): [number, number][] => [
  [x, 0],
  [x + size, 0],
  [x + size, size],
  [x, size],
]

const plate = (id: string, polygon: [number, number][], zoneIds: string[] = [], name?: string) =>
  SlabNode.parse({ id, parentId: 'level_a', plateRole: 'base', polygon, zoneIds, name })

const room = (id: string, polygon: [number, number][], name: string) =>
  ZoneNode.parse({ id, spaceRole: 'room', polygon, name })

const scene = (...nodes: AnyNode[]) => Object.fromEntries(nodes.map((node) => [node.id, node]))

test.each([
  'Room 3 Slab',
  'Kitchen slab',
  'Floor plate 12',
  'Slab 4',
  'Floor',
])('generated legacy name %s uses the shared footprint name', (name) => {
  const base = plate('slab_base', square(0, 4), [], name)
  expect(floorFootprintName(scene(base), base)).toBe('Floor area')
  const shed = room('zone_shed', base.polygon, 'Shed')
  const withShed = { ...base, zoneIds: [shed.id] }
  expect(floorFootprintName(scene(withShed, shed), withShed)).toBe('Shed floor')
  expect(floorFootprintName(scene(base), { ...base, name: 'Garden foundation' })).toBe(
    'Garden foundation',
  )
})

test('footprints never read as levels: Shared floor, then the largest room, then Floor area', () => {
  const kitchen = room('zone_kitchen', square(0, 6), 'Kitchen')
  const hall = room('zone_hall', square(6, 2), 'Hall')
  const nine = room('zone_nine', square(20, 3), 'Room 9')
  const pantry = room('zone_pantry', square(23, 1), 'Pantry')
  const house = plate('slab_house', square(0, 8), [kitchen.id, hall.id])
  const annex = plate('slab_annex', square(20, 4), [pantry.id, nine.id])
  const pad = plate('slab_pad', square(40, 2))
  const nodes = scene(kitchen, hall, nine, pantry, house, annex, pad)
  expect(floorFootprintName(nodes, house)).toBe('Shared floor')
  expect(floorFootprintName(nodes, annex)).toBe('Room 9 floor')
  expect(floorFootprintName(nodes, pad)).toBe('Floor area')
  const blank = room('zone_blank', square(20, 3), '')
  const unnamed = { ...annex, zoneIds: [blank.id] }
  expect(floorFootprintName({ ...nodes, [blank.id]: blank }, unnamed)).toBe('Floor area')
})
