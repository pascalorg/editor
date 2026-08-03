import { describe, expect, test } from 'bun:test'
import {
  aabbsOverlap,
  collectDoorKeepouts,
  doorKeepoutFromWall,
  findBlockedDoors,
  itemBlocksDoorKeepout,
  itemNodePlanAabb,
  itemPlanAabb,
  keepoutCoversPlanned,
  keepoutForPolygonEdge,
} from './door-clearance'
import type { AnyNode } from '@pascal-app/core/schema'

function wall(id: string, start: [number, number], end: [number, number]) {
  return {
    object: 'node' as const,
    id,
    type: 'wall' as const,
    parentId: 'level_1',
    visible: true,
    metadata: {},
    start,
    end,
    height: 2.5,
    thickness: 0.15,
    children: [] as string[],
  }
}

function door(id: string, wallId: string, localX: number, width = 0.8) {
  return {
    object: 'node' as const,
    id,
    type: 'door' as const,
    parentId: wallId,
    wallId,
    visible: true,
    metadata: {},
    position: [localX, 1.05, 0] as [number, number, number],
    width,
    height: 2.1,
  }
}

function level(id: string) {
  return {
    object: 'node' as const,
    id,
    type: 'level' as const,
    parentId: 'building_1',
    visible: true,
    metadata: {},
    children: [] as string[],
  }
}

function item(
  id: string,
  position: [number, number, number],
  dimensions: [number, number, number],
  name = 'Item',
  parentId = 'level_1',
  scale: [number, number, number] = [1, 1, 1],
) {
  return {
    object: 'node' as const,
    id,
    type: 'item' as const,
    parentId,
    visible: true,
    metadata: {},
    name,
    position,
    rotation: [0, 0, 0] as [number, number, number],
    scale,
    asset: {
      id: 'x',
      name,
      category: 'furniture',
      thumbnail: '',
      src: 'asset://x',
      dimensions,
    },
  }
}

describe('door-clearance', () => {
  test('doorKeepoutFromWall covers both sides of a horizontal wall door', () => {
    const w = wall('wall_1', [0, 2.5], [5.5, 2.5])
    const d = door('door_1', 'wall_1', 1.375, 0.8)
    const keepout = doorKeepoutFromWall(w, d, { clearDepth: 0.65, sidePad: 0.05 })
    expect(keepout).not.toBeNull()
    // Door center world ≈ (1.375, 2.5); keep-out extends ±0.65 in Z
    expect(keepout!.aabb.minZ).toBeLessThan(2.5 - 0.6)
    expect(keepout!.aabb.maxZ).toBeGreaterThan(2.5 + 0.6)
    expect(keepout!.aabb.minX).toBeLessThan(1.375)
    expect(keepout!.aabb.maxX).toBeGreaterThan(1.375)
  })

  test('item in clear zone blocks door; item outside does not', () => {
    const w = wall('wall_1', [0, 2.5], [5.5, 2.5])
    const d = door('door_1', 'wall_1', 1.375, 0.8)
    const keepout = doorKeepoutFromWall(w, d)!
    const toilet = itemPlanAabb([0.7, 0, 1.95], [1, 0.9, 1], 0)
    const farBed = itemPlanAabb([2.75, 0, 4.7], [2, 0.8, 2.5], 0)
    expect(itemBlocksDoorKeepout(toilet, keepout)).toBe(true)
    expect(itemBlocksDoorKeepout(farBed, keepout)).toBe(false)
  })

  test('findBlockedDoors reports furniture in keep-out', () => {
    const nodes = [
      wall('wall_1', [0, 2.5], [5.5, 2.5]),
      door('door_bath', 'wall_1', 1.375, 0.8),
      item('item_toilet', [0.7, 0, 1.95], [1, 0.9, 1], 'Toilet'),
      item('item_bed', [2.75, 0, 4.7], [2, 0.8, 2.5], 'Double Bed'),
    ] as unknown as AnyNode[]

    const issues = findBlockedDoors({ nodes })
    expect(issues.some((i) => i.itemId === 'item_toilet')).toBe(true)
    expect(issues.some((i) => i.itemId === 'item_bed')).toBe(false)
    expect(issues[0]?.message).toContain('blocked')
  })

  test('collectDoorKeepouts skips doors without a wall parent', () => {
    const nodes = [door('orphan', 'missing_wall', 1)] as unknown as AnyNode[]
    expect(collectDoorKeepouts(nodes)).toEqual([])
  })

  test('keepoutForPolygonEdge plans clearance on room edge', () => {
    const poly: [number, number][] = [
      [0, 0],
      [2.75, 0],
      [2.75, 2.5],
      [0, 2.5],
    ]
    // edge 2 is north wall [2.75,2.5] -> [0,2.5]
    const aabb = keepoutForPolygonEdge(poly, 2, { t: 0.5, width: 0.8, clearDepth: 0.85 })
    expect(aabb).not.toBeNull()
    expect(aabb!.minZ).toBeLessThan(2.5)
    expect(aabb!.maxZ).toBeGreaterThan(2.5)
  })

  test('aabbsOverlap: gap is minimum free space (not penetration depth)', () => {
    // Two 1x1 boxes centered 1.05 m apart on X → 0.05 m free gap between faces
    const a = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
    const b = { minX: 1.05, maxX: 2.05, minZ: 0, maxZ: 1 }
    expect(aabbsOverlap(a, b, 0)).toBe(false)
    // Require 0.08 m free → must report conflict
    expect(aabbsOverlap(a, b, 0.08)).toBe(true)
    // Far apart
    const c = { minX: 3, maxX: 4, minZ: 0, maxZ: 1 }
    expect(aabbsOverlap(a, c, 0.08)).toBe(false)
  })

  test('findBlockedDoors does not cross stacked levels (L1)', () => {
    const nodes = [
      level('level_1'),
      level('level_2'),
      { ...wall('wall_L1', [0, 2.5], [5.5, 2.5]), parentId: 'level_1' },
      { ...wall('wall_L2', [0, 2.5], [5.5, 2.5]), parentId: 'level_2' },
      door('door_L1', 'wall_L1', 1.375, 0.8),
      door('door_L2', 'wall_L2', 1.375, 0.8),
      // Toilet on L2 in same plan slot as L1 door
      item('toilet_L2', [0.7, 0, 1.95], [1, 0.9, 1], 'Toilet', 'level_2'),
    ] as unknown as AnyNode[]

    const l1 = findBlockedDoors({ nodes, levelId: 'level_1' })
    expect(l1.some((i) => i.itemId === 'toilet_L2')).toBe(false)
    const l2 = findBlockedDoors({ nodes, levelId: 'level_2' })
    expect(l2.some((i) => i.itemId === 'toilet_L2')).toBe(true)
  })

  test('itemNodePlanAabb respects scale (L4)', () => {
    const n = item('big', [0, 0, 0], [1, 1, 1], 'Big', 'level_1', [2, 1, 2])
    const aabb = itemNodePlanAabb(n as unknown as AnyNode)!
    // width 2, depth 2 → half 1
    expect(aabb.maxX - aabb.minX).toBeCloseTo(2, 5)
    expect(aabb.maxZ - aabb.minZ).toBeCloseTo(2, 5)
  })

  test('keepoutCoversPlanned detects covered entrance edge (L2 helper)', () => {
    const planned = keepoutForPolygonEdge(
      [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      0,
      { t: 0.5, width: 0.9 },
    )!
    const real = doorKeepoutFromWall(wall('w', [0, 0], [5, 0]), door('d', 'w', 2.5, 0.9))!
    expect(keepoutCoversPlanned(real.aabb, planned)).toBe(true)
    const elsewhere = { minX: 10, maxX: 11, minZ: 10, maxZ: 11 }
    expect(keepoutCoversPlanned(elsewhere, planned)).toBe(false)
  })

  test('keepoutCoversPlanned rejects glancing nearby door (L6)', () => {
    const planned = keepoutForPolygonEdge(
      [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      0,
      { t: 0.5, width: 0.9 },
    )!
    // Nearby keep-out that only barely overlaps planned AABB (not same opening center)
    const glancing = {
      minX: planned.maxX - 0.05,
      maxX: planned.maxX + 1,
      minZ: planned.minZ,
      maxZ: planned.maxZ,
    }
    expect(keepoutCoversPlanned(glancing, planned)).toBe(false)
  })
})
