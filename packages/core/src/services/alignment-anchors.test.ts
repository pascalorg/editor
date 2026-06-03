import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry'
import type { AnyNodeDefinition } from '../registry/types'
import type { AnyNode } from '../schema/types'
import {
  collectAlignmentAnchors,
  footprintAABB,
  footprintAABBFrom,
  movingFootprintAnchors,
  polygonAnchors,
  wallSegmentAnchors,
} from './alignment-anchors'

// Minimal floor-placed def whose footprint reads `dimensions` / `rotation`
// straight off the node, so tests can drive the AABB math directly.
function floorPlacedDef(kind: string, applies?: (n: AnyNode) => boolean): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
    capabilities: {
      floorPlaced: {
        footprint: (n: AnyNode) => ({
          dimensions: (n as { dimensions?: [number, number, number] }).dimensions ?? [1, 1, 1],
          rotation: (n as { rotation?: [number, number, number] }).rotation ?? [0, 0, 0],
        }),
        ...(applies ? { applies } : {}),
      },
    },
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition
}

function plainDef(kind: string): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
    capabilities: {},
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition
}

const node = (over: Record<string, unknown>): AnyNode => over as unknown as AnyNode

describe('footprintAABBFrom', () => {
  test('unrotated box is centred at position', () => {
    const aabb = footprintAABBFrom([10, 0, 20], [2, 1, 4], 0)
    expect(aabb).toEqual({ minX: 9, minZ: 18, maxX: 11, maxZ: 22 })
  })

  test('90° rotation swaps width and depth extents', () => {
    const aabb = footprintAABBFrom([0, 0, 0], [2, 1, 4], Math.PI / 2)
    expect(aabb.minX).toBeCloseTo(-2, 10)
    expect(aabb.maxX).toBeCloseTo(2, 10)
    expect(aabb.minZ).toBeCloseTo(-1, 10)
    expect(aabb.maxZ).toBeCloseTo(1, 10)
  })
})

describe('footprintAABB', () => {
  beforeEach(() => nodeRegistry._reset())

  test('reads dimensions + rotation from a floor-placed kind', () => {
    registerNode(floorPlacedDef('box'))
    const aabb = footprintAABB(
      node({ id: 'b1', type: 'box', position: [10, 0, 20], dimensions: [2, 1, 4] }),
    )
    expect(aabb).toEqual({ minX: 9, minZ: 18, maxX: 11, maxZ: 22 })
  })

  test('returns null for a kind without a footprint', () => {
    registerNode(plainDef('wall'))
    expect(footprintAABB(node({ id: 'w1', type: 'wall', position: [0, 0, 0] }))).toBeNull()
  })

  test('derives an elevator footprint from its width / depth (no floorPlaced needed)', () => {
    const aabb = footprintAABB(
      node({ id: 'e1', type: 'elevator', position: [10, 0, 20], width: 2, depth: 4, rotation: 0 }),
    )
    expect(aabb).toEqual({ minX: 9, minZ: 18, maxX: 11, maxZ: 22 })
  })

  test('returns null when the kind predicate excludes the node', () => {
    registerNode(floorPlacedDef('lamp', (n) => !(n as { attached?: boolean }).attached))
    expect(
      footprintAABB(node({ id: 'l1', type: 'lamp', position: [0, 0, 0], attached: true })),
    ).toBeNull()
    expect(
      footprintAABB(node({ id: 'l2', type: 'lamp', position: [0, 0, 0], attached: false })),
    ).not.toBeNull()
  })
})

describe('movingFootprintAnchors', () => {
  beforeEach(() => nodeRegistry._reset())

  test('relocates the footprint corners around the proposed centre (edges only, no centre anchor)', () => {
    registerNode(floorPlacedDef('box'))
    const anchors = movingFootprintAnchors(
      node({ id: 'm', type: 'box', position: [0, 0, 0], dimensions: [2, 1, 4] }),
      10,
      20,
    )
    // 2×4 box centred at (10, 20): corners at x∈{9,11}, z∈{18,22}.
    expect(anchors).toHaveLength(4)
    expect(anchors.every((a) => a.kind === 'corner')).toBe(true)
    expect(new Set(anchors.map((a) => a.x))).toEqual(new Set([9, 11]))
    expect(new Set(anchors.map((a) => a.z))).toEqual(new Set([18, 22]))
  })

  test('rotationY override drives the AABB regardless of node rotation', () => {
    registerNode(floorPlacedDef('box'))
    const anchors = movingFootprintAnchors(
      node({
        id: 'm',
        type: 'box',
        position: [0, 0, 0],
        dimensions: [2, 1, 4],
        rotation: [0, 0, 0],
      }),
      0,
      0,
      Math.PI / 2,
    )
    const xs = anchors.map((a) => a.x)
    // Rotated 90°, the 2×4 box spans ±2 in X (its depth) rather than ±1.
    expect(Math.max(...xs)).toBeCloseTo(2, 10)
    expect(Math.min(...xs)).toBeCloseTo(-2, 10)
  })

  test('returns empty for a footprintless kind', () => {
    registerNode(plainDef('wall'))
    expect(
      movingFootprintAnchors(node({ id: 'w', type: 'wall', position: [0, 0, 0] }), 1, 1),
    ).toEqual([])
  })
})

describe('wallSegmentAnchors', () => {
  test('returns both endpoints as corners and the chord midpoint as center', () => {
    const anchors = wallSegmentAnchors('w', [0, 0], [4, 2])
    expect(anchors).toEqual([
      { nodeId: 'w', kind: 'corner', x: 0, z: 0 },
      { nodeId: 'w', kind: 'corner', x: 4, z: 2 },
      { nodeId: 'w', kind: 'center', x: 2, z: 1 },
    ])
  })
})

describe('polygonAnchors', () => {
  test('returns each vertex as a corner anchor', () => {
    expect(
      polygonAnchors('s', [
        [0, 0],
        [2, 0],
        [2, 3],
      ]),
    ).toEqual([
      { nodeId: 's', kind: 'corner', x: 0, z: 0 },
      { nodeId: 's', kind: 'corner', x: 2, z: 0 },
      { nodeId: 's', kind: 'corner', x: 2, z: 3 },
    ])
  })
})

describe('collectAlignmentAnchors', () => {
  beforeEach(() => nodeRegistry._reset())

  test('unions footprint corners, segment anchors and polygon vertices, excluding the moving node', () => {
    registerNode(floorPlacedDef('box'))
    const nodes = {
      moving: node({ id: 'moving', type: 'box', position: [0, 0, 0], dimensions: [1, 1, 1] }),
      box: node({ id: 'box', type: 'box', position: [5, 0, 5], dimensions: [2, 1, 2] }),
      wall: node({ id: 'wall', type: 'wall', start: [0, 0], end: [4, 0] }),
      slab: node({
        id: 'slab',
        type: 'slab',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
      }),
    }
    const anchors = collectAlignmentAnchors(nodes, 'moving')
    const ids = anchors.map((a) => a.nodeId)
    expect(ids).not.toContain('moving')
    expect(ids.filter((id) => id === 'box')).toHaveLength(4) // corner anchors
    expect(ids.filter((id) => id === 'wall')).toHaveLength(3) // endpoints + midpoint
    expect(ids.filter((id) => id === 'slab')).toHaveLength(3) // polygon vertices
  })
})
