import { describe, expect, test } from 'bun:test'
import type { AnyNode, NodeEvent } from '@pascal-app/core'
import { type PointPickInput, resolvePointPick } from './pick'

// Point and ask (the owner, 8 October): the hover shows exactly what the click sends, by the
// editor's own predicate. Written first: a wall or floor picking the wall or floor instead of its
// room; the room still picked once it is the bubble's context; Alt not reaching the surface; a
// facade seen from outside picking the room behind it; a window picked through its wall; a node of
// another level picked; the ambiguity line missing where a deeper pick exists.

const LEVEL = 'level_0'
const OTHER_LEVEL = 'level_1'

const node = (fields: Record<string, unknown>) => fields as unknown as AnyNode
const nodes: Record<string, AnyNode> = {
  [LEVEL]: node({ id: LEVEL, type: 'level', parentId: 'building_1' }),
  [OTHER_LEVEL]: node({ id: OTHER_LEVEL, type: 'level', parentId: 'building_1' }),
  building_1: node({ id: 'building_1', type: 'building', parentId: 'site_1' }),
  site_1: node({ id: 'site_1', type: 'site' }),
  zone_kitchen: node({ id: 'zone_kitchen', type: 'zone', parentId: LEVEL }),
  wall_north: node({
    id: 'wall_north',
    type: 'wall',
    parentId: LEVEL,
    start: [0, 0],
    end: [4, 0],
  }),
  slab_kitchen: node({ id: 'slab_kitchen', type: 'slab', parentId: LEVEL }),
  ceiling_kitchen: node({ id: 'ceiling_kitchen', type: 'ceiling', parentId: LEVEL }),
  window_north: node({ id: 'window_north', type: 'window', parentId: 'wall_north' }),
  sofa: node({ id: 'sofa', type: 'item', parentId: LEVEL }),
  wall_up: node({ id: 'wall_up', type: 'wall', parentId: OTHER_LEVEL, start: [0, 0], end: [4, 0] }),
  roof_1: node({ id: 'roof_1', type: 'roof', parentId: LEVEL }),
  roof_segment_1: node({ id: 'roof_segment_1', type: 'roof-segment', parentId: 'roof_1' }),
}

const event = (
  id: string,
  extra: { position?: [number, number, number]; normal?: [number, number, number] } = {},
) =>
  ({
    node: nodes[id],
    position: extra.position ?? [2, 1, 0],
    localPosition: [0, 0, 0],
    normal: extra.normal,
    object: {},
    stopPropagation: () => {},
    nativeEvent: {},
  }) as unknown as NodeEvent

const KITCHEN = { levelId: LEVEL, zoneId: 'zone_kitchen' }

/** A scene where the kitchen is the room at every point south of the north wall (z > 0). */
const input = (id: string, over: Partial<PointPickInput> = {}): PointPickInput => ({
  event: event(id),
  alt: false,
  selectedTargetIds: [],
  nodes,
  currentLevelId: LEVEL,
  resolveRoom: () => KITCHEN,
  roomAtPoint: (_level, _x, z) => (z > 0 ? KITCHEN : null),
  ...over,
})

describe('room first', () => {
  test('a wall picks its room, and says the wall is a level deeper', () => {
    // The camera is inside: the hit normal points into the kitchen (+z).
    const pick = resolvePointPick(
      input('wall_north', { event: event('wall_north', { normal: [0, 0, 1] }) }),
    )

    expect(pick).toEqual({
      nodeId: 'zone_kitchen',
      via: 'wall_north',
      face: 'interior',
      ambiguous: true,
    })
  })

  test('a floor picks its room (face top), a ceiling its room (face bottom)', () => {
    expect(resolvePointPick(input('slab_kitchen'))).toEqual({
      nodeId: 'zone_kitchen',
      via: 'slab_kitchen',
      face: 'top',
      ambiguous: true,
    })
    expect(resolvePointPick(input('ceiling_kitchen'))).toEqual({
      nodeId: 'zone_kitchen',
      via: 'ceiling_kitchen',
      face: 'bottom',
      ambiguous: true,
    })
  })

  test('a plate or wall with no room behind it picks itself', () => {
    expect(resolvePointPick(input('slab_kitchen', { resolveRoom: () => null }))).toEqual({
      nodeId: 'slab_kitchen',
      face: 'top',
      ambiguous: false,
    })
  })

  test('once the room is the bubble’s context, the surface itself picks', () => {
    const wall = resolvePointPick(
      input('wall_north', {
        event: event('wall_north', { normal: [0, 0, 1] }),
        selectedTargetIds: ['zone_kitchen'],
      }),
    )
    expect(wall).toEqual({ nodeId: 'wall_north', face: 'interior', ambiguous: false })

    const floor = resolvePointPick(input('slab_kitchen', { selectedTargetIds: ['zone_kitchen'] }))
    expect(floor).toEqual({ nodeId: 'slab_kitchen', face: 'top', ambiguous: false })
  })
})

describe('Alt goes one level deeper', () => {
  test('to the wall, the floor or the ceiling under the cursor', () => {
    expect(
      resolvePointPick(
        input('wall_north', { alt: true, event: event('wall_north', { normal: [0, 0, 1] }) }),
      ),
    ).toEqual({ nodeId: 'wall_north', face: 'interior', ambiguous: false })
    expect(resolvePointPick(input('slab_kitchen', { alt: true }))).toEqual({
      nodeId: 'slab_kitchen',
      face: 'top',
      ambiguous: false,
    })
    expect(resolvePointPick(input('ceiling_kitchen', { alt: true }))?.nodeId).toBe(
      'ceiling_kitchen',
    )
  })
})

describe('from outside, “this” is the facade', () => {
  const outside = event('wall_north', { normal: [0, 0, -1], position: [2, 1, 0] })

  test('an exterior wall face picks the wall, not the room behind it', () => {
    expect(resolvePointPick(input('wall_north', { event: outside }))).toEqual({
      nodeId: 'wall_north',
      face: 'exterior',
      ambiguous: false,
    })
  })

  test('the same with Alt', () => {
    expect(resolvePointPick(input('wall_north', { event: outside, alt: true }))?.face).toBe(
      'exterior',
    )
  })

  test('a wall hit that carries no normal falls back to the editor’s room', () => {
    expect(resolvePointPick(input('wall_north'))?.nodeId).toBe('zone_kitchen')
  })
})

describe('picked directly', () => {
  test('a window, an item and a roof segment pick themselves, with no ambiguity line', () => {
    expect(resolvePointPick(input('window_north'))).toEqual({
      nodeId: 'window_north',
      ambiguous: false,
    })
    expect(resolvePointPick(input('sofa'))).toEqual({ nodeId: 'sofa', ambiguous: false })
  })

  test('a roof picks the segment under the cursor when the editor can say', () => {
    expect(
      resolvePointPick(
        input('roof_1', { resolveRoofSegment: () => nodes.roof_segment_1 as AnyNode }),
      ),
    ).toEqual({ nodeId: 'roof_segment_1', ambiguous: false })
    expect(resolvePointPick(input('roof_1'))?.nodeId).toBe('roof_1')
  })

  test('the editor’s selection proxy decides which node a body pick lands on', () => {
    const picked = resolvePointPick(
      input('window_north', { resolveNode: () => nodes.wall_north as AnyNode, alt: true }),
    )

    expect(picked?.nodeId).toBe('wall_north')
  })
})

describe('what is not pickable', () => {
  test('a node of another level', () => {
    expect(resolvePointPick(input('wall_up'))).toBeNull()
  })

  test('with no level in view, every level is pickable', () => {
    expect(resolvePointPick(input('wall_up', { currentLevelId: null, alt: true }))?.nodeId).toBe(
      'wall_up',
    )
  })

  test('the building and the site, inside a building', () => {
    expect(resolvePointPick(input('building_1'))).toBeNull()
    expect(resolvePointPick(input('site_1'))).toBeNull()
  })

  test('the building from the site phase', () => {
    expect(resolvePointPick(input('building_1', { phase: 'site', currentLevelId: null }))).toEqual({
      nodeId: 'building_1',
      ambiguous: false,
    })
  })

  test('a zone outside the zone layer', () => {
    expect(resolvePointPick(input('zone_kitchen'))).toBeNull()
    expect(resolvePointPick(input('zone_kitchen', { zonesPickable: true }))?.nodeId).toBe(
      'zone_kitchen',
    )
  })

  test('the ceiling grid, which belongs to the ceiling tool', () => {
    const grid = event('ceiling_kitchen')
    ;(grid.object as { name?: string }).name = 'ceiling-grid'

    expect(resolvePointPick(input('ceiling_kitchen', { event: grid }))).toBeNull()
  })
})
