import { describe, expect, test } from 'bun:test'
import { classifyRoom, extractLevels, extractRooms, extractSlabs, extractWalls } from './wall-model'

/** Synthetic scene records shaped exactly like the host stores them. */
const nodes: Record<string, Record<string, unknown>> = {
  level_1: { id: 'level_1', type: 'level', level: 0, height: 2.7 },
  level_2: { id: 'level_2', type: 'level', level: 1, height: 2.6 },
  wall_a: {
    id: 'wall_a',
    type: 'wall',
    parentId: 'level_1',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.15,
    height: 2.5,
    frontSide: 'interior',
    backSide: 'exterior',
    children: ['door_1', 'window_1', 'item_1'],
  },
  wall_b: {
    id: 'wall_b',
    type: 'wall',
    parentId: 'level_1',
    start: [0, 0],
    end: [0, 3],
    curveOffset: 0.4,
    children: [],
  },
  wall_other_level: {
    id: 'wall_other_level',
    type: 'wall',
    parentId: 'level_2',
    start: [0, 0],
    end: [2, 0],
    children: [],
  },
  wall_degenerate: {
    id: 'wall_degenerate',
    type: 'wall',
    parentId: 'level_1',
    start: [1, 1],
    end: [1.01, 1],
    children: [],
  },
  door_1: { id: 'door_1', type: 'door', position: [1.2, 1.05, 0], width: 0.9, height: 2.1 },
  window_1: {
    id: 'window_1',
    type: 'window',
    position: [3, 1.5, 0],
    width: 1.2,
    height: 1.2,
    roughOpeningWidth: 1.28,
  },
  item_1: { id: 'item_1', type: 'item', position: [2, 0, 0] },
  slab_1: {
    id: 'slab_1',
    type: 'slab',
    parentId: 'level_1',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    elevation: 0.05,
    thickness: 0.2,
  },
  zone_kitchen: {
    id: 'zone_kitchen',
    type: 'zone',
    parentId: 'level_1',
    name: 'Kitchen',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    boundaryWallIds: ['wall_a'],
    ceilingHeight: 2.4,
  },
}

describe('extractWalls', () => {
  const walls = extractWalls(nodes, 'level_1')

  test('finds the level walls, skips other levels and degenerate stubs', () => {
    expect(walls.map((w) => w.id).sort()).toEqual(['wall_a', 'wall_b'])
  })

  test('reads geometry and marks exterior from either face', () => {
    const a = walls.find((w) => w.id === 'wall_a')
    expect(a?.length).toBeCloseTo(4, 5)
    expect(a?.thickness).toBeCloseTo(0.15, 5)
    expect(a?.exterior).toBe(true)
    expect(a?.curved).toBe(false)
  })

  test('flags curved walls', () => {
    expect(walls.find((w) => w.id === 'wall_b')?.curved).toBe(true)
  })

  test('extracts door + window children (not items), sorted by u', () => {
    const a = walls.find((w) => w.id === 'wall_a')
    expect(a?.openings.map((o) => o.kind)).toEqual(['door', 'window'])
    const [door, win] = a?.openings ?? []
    expect(door?.u).toBeCloseTo(1.2, 5)
    expect(door?.sillHeight).toBe(0)
    // window: center 1.5, height 1.2 → sill at 0.9
    expect(win?.sillHeight).toBeCloseTo(0.9, 5)
    // host rough opening wins when present
    expect(win?.roughWidth).toBeCloseTo(1.28, 5)
    // door defaults to nominal + 1.5"
    expect(door?.roughWidth).toBeCloseTo(0.9 + 0.0381, 4)
  })
})

describe('extractSlabs / extractLevels / extractRooms', () => {
  test('slab polygon and thickness', () => {
    const slabs = extractSlabs(nodes, 'level_1')
    expect(slabs).toHaveLength(1)
    expect(slabs[0]?.polygon).toHaveLength(4)
    expect(slabs[0]?.thickness).toBeCloseTo(0.2, 5)
  })

  test('levels sorted bottom → top', () => {
    const levels = extractLevels(nodes)
    expect(levels.map((l) => l.id)).toEqual(['level_1', 'level_2'])
  })

  test('rooms classified from names', () => {
    const rooms = extractRooms(nodes, 'level_1')
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.category).toBe('kitchen')
    expect(rooms[0]?.boundaryWallIds).toEqual(['wall_a'])
  })
})

describe('extractRooms — zone-twin dedupe (S8 class)', () => {
  const BASE: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ]
  const zoneNode = (
    id: string,
    name: string,
    polygon: [number, number][],
    boundaryWallIds: string[] = [],
  ): Record<string, unknown> => ({ id, type: 'zone', parentId: 'level_z', name, polygon, boundaryWallIds })
  const scene = (
    ...zones: Record<string, unknown>[]
  ): Record<string, Record<string, unknown>> => ({
    level_z: { id: 'level_z', type: 'level', level: 0, height: 2.7 },
    ...Object.fromEntries(zones.map((z) => [String(z.id), z])),
  })
  const shift = (poly: [number, number][], dx: number, dz: number): [number, number][] =>
    poly.map(([x, z]) => [x + dx, z + dz])

  test('exact twins collapse to ONE room; the CATEGORIZED name beats "other"', () => {
    const log: { kept: string; dropped: string }[] = []
    const rooms = extractRooms(scene(zoneNode('z_a', 'Living', BASE), zoneNode('z_b', 'Kitchen', BASE)), 'level_z', log)
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.name).toBe('Kitchen')
    expect(rooms[0]?.category).toBe('kitchen')
    expect(log).toEqual([{ kept: 'Kitchen', dropped: 'Living' }])
  })

  test('5 mm re-detection drift still merges; the LONGER name wins among equals', () => {
    const rooms = extractRooms(
      scene(zoneNode('z_a', 'Kitchen', BASE), zoneNode('z_b', 'Living / Kitchen', shift(BASE, 0.005, 0.005))),
      'level_z',
    )
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.name).toBe('Living / Kitchen')
  })

  test('rotated start vertex and reversed winding are the SAME polygon', () => {
    const rotated: [number, number][] = [
      [6, 0],
      [6, 4],
      [0, 4],
      [0, 0],
    ]
    const reversed = [...BASE].reverse() as [number, number][]
    expect(extractRooms(scene(zoneNode('z_a', 'Kitchen', BASE), zoneNode('z_b', 'Living', rotated)), 'level_z')).toHaveLength(1)
    expect(extractRooms(scene(zoneNode('z_a', 'Kitchen', BASE), zoneNode('z_b', 'Living', reversed)), 'level_z')).toHaveLength(1)
  })

  test('genuinely distinct zones NEVER merge — 5 cm offset is two rooms', () => {
    const rooms = extractRooms(
      scene(zoneNode('z_a', 'Kitchen', BASE), zoneNode('z_b', 'Kitchen 2', shift(BASE, 0.05, 0))),
      'level_z',
    )
    expect(rooms).toHaveLength(2)
  })

  test("the dropped twin's boundaryWallIds union onto the kept room (S8 opening-merge mirror)", () => {
    const rooms = extractRooms(
      scene(zoneNode('z_a', 'Living', BASE, ['wall_1', 'wall_2']), zoneNode('z_b', 'Kitchen', BASE, ['wall_2', 'wall_3'])),
      'level_z',
    )
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.boundaryWallIds).toEqual(['wall_2', 'wall_3', 'wall_1'])
  })

  test('full ties break on the smaller id — deterministic across hosts', () => {
    const rooms = extractRooms(
      scene(zoneNode('z_b', 'Kitchen', BASE), zoneNode('z_a', 'Cuisine', BASE)),
      'level_z',
    )
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.id).toBe('z_a')
  })

  test('room order stays SCENE order — dedupe never re-sorts (byte-equality contract)', () => {
    const other: [number, number][] = [
      [10, 0],
      [16, 0],
      [16, 4],
      [10, 4],
    ]
    const rooms = extractRooms(
      scene(zoneNode('z_x', 'Bedroom', other), zoneNode('z_y', 'Living', BASE), zoneNode('z_z', 'Kitchen', BASE)),
      'level_z',
    )
    expect(rooms.map((r) => r.name)).toEqual(['Bedroom', 'Kitchen'])
  })
})

describe('classifyRoom', () => {
  test('multilingual room names', () => {
    expect(classifyRoom('Master Bedroom')).toBe('bedroom')
    expect(classifyRoom('Salle de bain')).toBe('bathroom')
    expect(classifyRoom('Cuisine')).toBe('kitchen')
    expect(classifyRoom('Garage')).toBe('garage')
    expect(classifyRoom('Laundry / Utility')).toBe('laundry')
    expect(classifyRoom('Living')).toBe('other')
  })
})

describe('extractPlacedFixtures — placed items are the plumbing demand points', () => {
  const { extractPlacedFixtures } = require('./wall-model') as typeof import('./wall-model')
  test('maps catalog asset ids to sanitary profiles (IRC P3004.1 / P3201.7)', () => {
    const nodes = {
      lvl: { id: 'lvl', type: 'level', level: 0, height: 2.5 },
      t: { id: 't', type: 'item', parentId: 'lvl', position: [10.9, 0, 6.95], rotation: [0, Math.PI, 0], asset: { id: 'toilet' } },
      s: { id: 's', type: 'item', parentId: 'lvl', position: [2, 0, 3], rotation: [0, 0, 0], asset: { id: 'shower-square' } },
      chair: { id: 'chair', type: 'item', parentId: 'lvl', position: [5, 0, 5], rotation: [0, 0, 0], asset: { id: 'armchair' } },
      other: { id: 'other', type: 'item', parentId: 'other-level', position: [1, 0, 1], rotation: [0, 0, 0], asset: { id: 'bathtub' } },
    } as Record<string, Record<string, unknown>>
    const placed = extractPlacedFixtures(nodes, 'lvl')
    expect(placed.map((p) => p.kind).sort()).toEqual(['shower', 'toilet'])
    const toilet = placed.find((p) => p.kind === 'toilet')
    expect(toilet?.hot).toBe(false)
    expect(toilet?.dfu).toBe(3)
    expect(toilet?.drainIn).toBe(3)
    expect(toilet?.plan).toEqual([10.9, 6.95])
    const shower = placed.find((p) => p.kind === 'shower')
    expect(shower?.hot).toBe(true)
  })
})
