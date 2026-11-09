import { describe, expect, test } from 'bun:test'
import { setRoomFloorConstruction } from '../commands/structure/set-room-floor-construction'
import { setZoneIntent } from '../commands/structure/set-zone-intent'
import { type AnyNode, LevelNode, SlabNode, ZoneNode } from '../schema'
import { roomDrawnFloor } from './room-drawn-floor'

type Ring = [number, number][]
const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const LEVEL = 'level_drawn'

/**
 * A legacy ground floor kept as drawn slabs: the old wall-generated slab (now
 * a demoted manual slab at 0.05) under both rooms, the bedroom's own
 * hand-drawn slab at 0.15 on top of it, and a hall floored by two drawn slabs.
 */
function scene(extra: AnyNode[] = []) {
  const level = LevelNode.parse({ id: LEVEL, level: 0, height: 3 })
  const legacy = SlabNode.parse({
    id: 'slab_legacy',
    name: 'Room 1 Slab',
    parentId: LEVEL,
    polygon: rect(0, 0, 12, 4),
    elevation: 0.05,
    thickness: 0.05,
    metadata: { plateMigration: { demoted: 'wall-supported-floor' } },
  })
  const bedroomSlab = SlabNode.parse({
    id: 'slab_bedroom',
    name: 'Slab 4',
    parentId: LEVEL,
    polygon: rect(0, 0, 4, 4),
    elevation: 0.15,
    thickness: 0.15,
  })
  const hallHalf = SlabNode.parse({
    id: 'slab_hall_half',
    name: 'Slab 2',
    parentId: LEVEL,
    polygon: rect(8, 0, 10, 4),
    elevation: 0.15,
    thickness: 0.15,
  })
  const zone = (id: string, name: string, polygon: Ring, sourceSlabId?: `slab_${string}`) =>
    ZoneNode.parse({
      id,
      name,
      parentId: LEVEL,
      spaceRole: 'room',
      polygon,
      floor: sourceSlabId ? { sourceSlabId, elevation: 0.05 } : undefined,
    })
  const all = [
    level,
    legacy,
    bedroomSlab,
    hallHalf,
    zone('zone_bedroom', 'Master bedroom', rect(0, 0, 4, 4), 'slab_legacy'),
    zone('zone_living', 'Living room', rect(4, 0, 8, 4), 'slab_legacy'),
    zone('zone_hall', 'Hall', rect(8, 0, 12, 4), 'slab_legacy'),
    ...extra,
  ]
  level.children = all.filter((node) => node.parentId === LEVEL).map((node) => node.id) as never
  return Object.fromEntries(all.map((node) => [node.id, node])) as Record<string, AnyNode>
}

describe('roomDrawnFloor', () => {
  test('names the drawn slab the room visibly stands on, not the hidden one it came from', () => {
    const floor = roomDrawnFloor(scene(), 'zone_bedroom')
    expect(floor).toEqual({
      sourceId: 'slab_legacy',
      slabId: 'slab_bedroom',
      sharedZoneIds: [],
      ambiguous: false,
    })
  })

  test('a room on the source slab itself shares it with every room it floors', () => {
    const floor = roomDrawnFloor(scene(), 'zone_living')
    expect(floor?.slabId).toBe('slab_legacy')
    expect(floor?.sharedZoneIds).toEqual(['zone_bedroom', 'zone_hall'])
    expect(floor?.ambiguous).toBe(false)
  })

  test('two drawn slabs showing in one room make it ambiguous', () => {
    const floor = roomDrawnFloor(scene(), 'zone_hall')
    expect(floor?.ambiguous).toBe(true)
    // Equal shares: the higher slab names the floor.
    expect(floor?.slabId).toBe('slab_hall_half')
  })

  test('a drawn-slab room with its floor switched off still stands on the slab', () => {
    const nodes = scene()
    const bedroom = nodes.zone_bedroom as ZoneNode
    nodes.zone_bedroom = { ...bedroom, hasFloor: false }
    expect(roomDrawnFloor(nodes, 'zone_bedroom')?.slabId).toBe('slab_bedroom')
  })

  test('rooms on generated plates, without a source, or on a mezzanine are not drawn-slab rooms', () => {
    const nodes = scene([
      ZoneNode.parse({
        id: 'zone_plain',
        name: 'zone_plain',
        parentId: LEVEL,
        spaceRole: 'room',
        polygon: rect(20, 0, 24, 4),
      }),
      ZoneNode.parse({
        id: 'zone_mezz',
        name: 'zone_mezz',
        parentId: LEVEL,
        spaceRole: 'room',
        polygon: rect(0, 0, 2, 2),
        floor: { support: 'open', elevation: 1.5, sourceSlabId: 'slab_legacy' },
      }),
      ZoneNode.parse({
        id: 'zone_far',
        name: 'zone_far',
        parentId: LEVEL,
        spaceRole: 'room',
        polygon: rect(30, 0, 34, 4),
        // A source that no longer reaches the room does not keep it off plates.
        floor: { sourceSlabId: 'slab_legacy' },
      }),
    ])
    expect(roomDrawnFloor(nodes, 'zone_plain')).toBeNull()
    expect(roomDrawnFloor(nodes, 'zone_mezz')).toBeNull()
    expect(roomDrawnFloor(nodes, 'zone_far')).toBeNull()
    const plated = {
      ...nodes,
      slab_legacy: { ...nodes.slab_legacy, plateRole: 'base', boundary: 'auto' } as AnyNode,
    }
    expect(roomDrawnFloor(plated, 'zone_living')).toBeNull()
  })
})

describe('a drawn-slab room refuses a floor height', () => {
  test('setZoneIntent refuses a new elevation and names the slab to edit', () => {
    const plan = setZoneIntent(scene(), {
      zoneId: 'zone_bedroom',
      patch: { floor: { elevation: 0.8 } },
    })
    expect(plan.changes).toEqual([])
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts![0]!.code).toBe('room-drawn-floor')
    expect(plan.conflicts![0]!.nodeIds).toEqual(['zone_bedroom', 'slab_bedroom'])
    expect(plan.conflicts![0]!.message).toContain('"Slab 4" (slab_bedroom)')
  })

  test('other floor intent, an unchanged height and clearing the height still apply', () => {
    const nodes = scene()
    for (const floor of [
      { finish: 'library:preset-white' },
      { elevation: 0.05 },
      { elevation: null },
    ]) {
      const plan = setZoneIntent(nodes, { zoneId: 'zone_bedroom', patch: { floor } })
      expect(plan.conflicts).toBeUndefined()
    }
    const cleared = setZoneIntent(nodes, {
      zoneId: 'zone_bedroom',
      patch: { floor: { elevation: null } },
    })
    expect(cleared.changes).toEqual([
      { op: 'update', id: 'zone_bedroom', data: { floor: { sourceSlabId: 'slab_legacy' } } },
    ])
  })

  test('a room that is not a drawn-slab room keeps its floor height', () => {
    const nodes = scene([
      ZoneNode.parse({
        id: 'zone_plain',
        name: 'zone_plain',
        parentId: LEVEL,
        spaceRole: 'room',
        polygon: rect(20, 0, 24, 4),
      }),
    ])
    const plan = setZoneIntent(nodes, {
      zoneId: 'zone_plain',
      patch: { floor: { elevation: 0.3 } },
    })
    expect(plan.conflicts).toBeUndefined()
    expect(plan.changes).toHaveLength(1)
  })

  test('floor construction edits the visible drawn slab by default', () => {
    const plan = setRoomFloorConstruction(scene(), {
      zoneId: 'zone_bedroom',
      patch: { thickness: 0.2 },
    })
    expect(plan.conflicts).toBeUndefined()
    expect(plan.changes).toEqual([{ op: 'update', id: 'slab_bedroom', data: { thickness: 0.2 } }])
  })
})
