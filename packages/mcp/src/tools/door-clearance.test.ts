import { describe, expect, test } from 'bun:test'
import {
  collectDoorKeepouts,
  doorKeepoutFromWall,
  findBlockedDoors,
  itemBlocksDoorKeepout,
  itemPlanAabb,
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

function item(
  id: string,
  position: [number, number, number],
  dimensions: [number, number, number],
  name = 'Item',
) {
  return {
    object: 'node' as const,
    id,
    type: 'item' as const,
    parentId: 'level_1',
    visible: true,
    metadata: {},
    name,
    position,
    rotation: [0, 0, 0] as [number, number, number],
    asset: {
      id: 'x',
      name,
      category: 'furniture',
      thumbnail: '',
      src: '',
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
})
