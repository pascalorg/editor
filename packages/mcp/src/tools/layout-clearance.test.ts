import { describe, expect, test } from 'bun:test'
import {
  classifyPlacement,
  findItemItemCollisions,
  findValidPlacement,
  generatePlacementCandidates,
  itemPlanAabb,
  layoutIssuesFromScene,
} from './layout-clearance'
import type { AnyNode } from '@pascal-app/core/schema'

function item(
  id: string,
  position: [number, number, number],
  dimensions: [number, number, number],
  name = 'Item',
  rotY = 0,
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
    rotation: [0, rotY, 0] as [number, number, number],
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

describe('layout-clearance', () => {
  test('findItemItemCollisions detects rotated footprint overlap', () => {
    // Two 2x1 footprints; second rotated 90° so it extends along X
    const a = item('a', [0, 0, 0], [2, 1, 1], 'A', 0)
    const b = item('b', [0.9, 0, 0], [2, 1, 1], 'B', Math.PI / 2)
    const hits = findItemItemCollisions({ nodes: [a, b] as unknown as AnyNode[] })
    expect(hits.length).toBe(1)
    expect(hits[0]!.message).toContain('overlap')
  })

  test('findItemItemCollisions ignores separated items', () => {
    const a = item('a', [0, 0, 0], [1, 1, 1], 'A')
    const b = item('b', [3, 0, 0], [1, 1, 1], 'B')
    expect(findItemItemCollisions({ nodes: [a, b] as unknown as AnyNode[] })).toEqual([])
  })

  test('classifyPlacement flags door keep-out and item overlap', () => {
    const aabb = itemPlanAabb([1, 0, 1], [1, 1, 1], 0)
    expect(
      classifyPlacement({
        aabb,
        doorKeepouts: [{ minX: 0.5, maxX: 1.5, minZ: 0.5, maxZ: 1.5 }],
        occupied: [],
      }),
    ).toBe('blocks_door_clearance')
    expect(
      classifyPlacement({
        aabb,
        doorKeepouts: [],
        occupied: [{ minX: 0.5, maxX: 1.5, minZ: 0.5, maxZ: 1.5 }],
      }),
    ).toBe('overlaps_item')
    expect(
      classifyPlacement({
        aabb,
        doorKeepouts: [],
        occupied: [{ minX: 5, maxX: 6, minZ: 5, maxZ: 6 }],
      }),
    ).toBe('ok')
  })

  test('findValidPlacement nudges off an overlapping neighbor', () => {
    const primary = { x: 2, z: 2, rotationDeg: 0 }
    // Blocker sits on primary
    const occupied = [itemPlanAabb([2, 0, 2], [1.2, 1, 1.2], 0)]
    const found = findValidPlacement({
      primary,
      dimensions: [1, 1, 1],
      doorKeepouts: [],
      occupied,
      roomBounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 6 },
      along: { x: 1, z: 0 },
      inward: { x: 0, z: 1 },
    })
    expect(found.candidate).not.toBeNull()
    expect(found.candidate!.x !== 2 || found.candidate!.z !== 2).toBe(true)
  })

  test('generatePlacementCandidates includes primary and offsets', () => {
    const c = generatePlacementCandidates(
      { x: 0, z: 0, rotationDeg: 0 },
      { lateralsM: [0, 1], insetsM: [0, 0.5], along: { x: 1, z: 0 }, inward: { x: 0, z: 1 } },
    )
    expect(c.some((p) => p.x === 0 && p.z === 0)).toBe(true)
    expect(c.some((p) => p.x === 1 && p.z === 0)).toBe(true)
    expect(c.some((p) => p.x === 0 && p.z === 0.5)).toBe(true)
  })

  test('layoutIssuesFromScene merges door blocks and item overlaps', () => {
    const wall = {
      object: 'node' as const,
      id: 'wall_1',
      type: 'wall' as const,
      parentId: 'level_1',
      visible: true,
      metadata: {},
      start: [0, 2.5] as [number, number],
      end: [5.5, 2.5] as [number, number],
      height: 2.5,
      thickness: 0.15,
      children: [] as string[],
    }
    const door = {
      object: 'node' as const,
      id: 'door_1',
      type: 'door' as const,
      parentId: 'wall_1',
      wallId: 'wall_1',
      visible: true,
      metadata: {},
      position: [1.375, 1.05, 0] as [number, number, number],
      width: 0.8,
      height: 2.1,
    }
    const toilet = item('t', [0.7, 0, 1.95], [1, 0.9, 1], 'Toilet')
    const a = item('a', [3, 0, 4], [1.5, 1, 1.5], 'A')
    const b = item('b', [3.2, 0, 4.1], [1.5, 1, 1.5], 'B')
    const issues = layoutIssuesFromScene([wall, door, toilet, a, b] as unknown as AnyNode[])
    expect(issues.some((m) => m.includes('blocked'))).toBe(true)
    expect(issues.some((m) => m.includes('overlap'))).toBe(true)
  })
})
