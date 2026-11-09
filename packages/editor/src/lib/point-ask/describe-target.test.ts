import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { house } from './__fixtures__/house'
import { describeTarget } from './describe-target'

// Point and ask names what the finger is on, in the viewer's unit, for the label chip and the
// bubble's context row, and in metres for the agent (the context's `size`). Written first: a size
// in the wrong unit; a wall that does not say which room it bounds; a window's sill missing from the
// context; an element of a kind nobody described showing no name at all.

const nodes = house()
const metric = { unit: 'metric' } as const
const at = (id: string, unit: Parameters<typeof describeTarget>[2] = metric) =>
  describeTarget(nodes[id] as AnyNode, nodes, unit)

describe('a room', () => {
  test('is named by its zone, sized by its area, and is the kind "room"', () => {
    const room = at('zone_kitchen')

    expect(room).toMatchObject({
      id: 'zone_kitchen',
      type: 'zone',
      kind: 'room',
      name: 'Kitchen',
      size: '12.0 m²',
      levelId: 'level_0',
    })
    expect(room.sizes).toEqual({ area: 12, width: 4, depth: 3 })
    expect(room.zoneId).toBeUndefined()
  })

  test('a room with no name is "Room"', () => {
    const unnamed = { ...nodes.zone_kitchen, name: '' } as AnyNode

    expect(describeTarget(unnamed, { ...nodes, zone_kitchen: unnamed }, metric).name).toBe('Room')
  })
})

describe('a wall', () => {
  test('says which room it bounds, its length by its height, and the room it is in', () => {
    const wall = at('wall_north')

    expect(wall).toMatchObject({ kind: 'wall', name: 'Wall · Kitchen', zoneId: 'zone_kitchen' })
    expect(wall.sizes.length).toBeCloseTo(4, 6)
    expect(wall.sizes.thickness).toBeGreaterThan(0)
    expect(wall.size).toBe(`4.00 × ${wall.sizes.height!.toFixed(2)} m`)
  })

  test('a wall bounding no room is just "Wall"', () => {
    const { zone_kitchen: _gone, ...without } = nodes
    const wall = describeTarget(nodes.wall_north as AnyNode, without as typeof nodes, metric)

    expect(wall.name).toBe('Wall')
    expect(wall.zoneId).toBeUndefined()
  })
})

describe('a window and a door', () => {
  test('a window: width by height, its sill in the context, its wall as parent', () => {
    const window = at('window_north')

    expect(window).toMatchObject({
      kind: 'window',
      name: 'Window',
      size: '1.20 × 1.40 m',
      parentId: 'wall_north',
      zoneId: 'zone_kitchen',
    })
    expect(window.sizes.width).toBeCloseTo(1.2, 6)
    expect(window.sizes.height).toBeCloseTo(1.4, 6)
    expect(window.sizes.sill).toBeCloseTo(0.7, 6)
  })

  test('a door stands on the floor: sill 0', () => {
    const door = at('door_front')

    expect(door).toMatchObject({ kind: 'door', name: 'Door', size: '0.90 × 2.10 m' })
    expect(door.sizes.sill).toBeCloseTo(0, 6)
  })
})

describe('an item', () => {
  test('is named by the person’s name, sized by its width, and sits in the room it stands in', () => {
    const sofa = at('item_sofa')

    expect(sofa).toMatchObject({
      kind: 'item',
      name: 'Sofa',
      size: '2.10 m wide',
      zoneId: 'zone_kitchen',
    })
    expect(sofa.parentId).toBeUndefined()
    expect(sofa.sizes).toEqual({ width: 2.1, depth: 0.95, height: 0.85 })
  })

  test('with no name it is the asset’s, and then just "Item"', () => {
    const unnamed = { ...nodes.item_sofa, name: undefined } as AnyNode
    expect(describeTarget(unnamed, nodes, metric).name).toBe('Oslo 3-seat')

    const bare = {
      ...nodes.item_sofa,
      name: undefined,
      asset: { ...(nodes.item_sofa as never as { asset: object }).asset, name: '' },
    } as AnyNode
    expect(describeTarget(bare, nodes, metric).name).toBe('Item')
  })
})

describe('units', () => {
  test('imperial reads in feet, inches and square feet', () => {
    const imperial = { unit: 'imperial' } as const

    expect(at('zone_kitchen', imperial).size).toBe('129.2 ft²')
    expect(at('window_north', imperial).size).toBe(`3'11" × 4'7"`)
    expect(at('item_sofa', imperial).size).toBe(`6'11" wide`)
    // The context stays in metres whatever the viewer shows.
    expect(at('window_north', imperial).sizes.width).toBeCloseTo(1.2, 6)
  })

  test('millimetres when the viewer shows them', () => {
    const mm = { unit: 'metric', metricNotation: 'millimeters' } as const

    expect(at('window_north', mm).size).toBe('1200 × 1400 mm')
    expect(at('item_sofa', mm).size).toBe('2100 mm wide')
  })
})

describe('everything else', () => {
  test('a kind nobody described still has a name and a type', () => {
    const odd = {
      id: 'column_1',
      type: 'column',
      parentId: 'level_0',
      name: 'Pillar',
    } as unknown as AnyNode
    const anonymous = { id: 'fence_1', type: 'fence', parentId: 'level_0' } as unknown as AnyNode

    expect(describeTarget(odd, { ...nodes, column_1: odd }, metric)).toMatchObject({
      kind: 'other',
      name: 'Pillar',
      type: 'column',
    })
    expect(describeTarget(anonymous, { ...nodes, fence_1: anonymous }, metric).name).toBe('Fence')
  })

  test('a roof segment is the kind "roof" and a stair the kind "stair"', () => {
    const segment = {
      id: 'roof_segment_1',
      type: 'roof-segment',
      parentId: 'roof_1',
      width: 8,
      depth: 6,
    } as unknown as AnyNode
    const stair = {
      id: 'stair_1',
      type: 'stair',
      parentId: 'level_0',
      width: 1,
      totalRise: 2.7,
    } as unknown as AnyNode

    expect(describeTarget(segment, nodes, metric).kind).toBe('roof')
    expect(describeTarget(stair, nodes, metric).kind).toBe('stair')
  })
})
