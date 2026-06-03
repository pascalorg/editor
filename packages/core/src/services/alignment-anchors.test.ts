import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry'
import type { AnyNodeDefinition } from '../registry/types'
import type { AnyNode } from '../schema/types'
import type { AlignmentGuide } from './alignment'
import {
  collectAlignmentCandidates,
  collectFloorFootprints,
  type FootprintAABB,
  footprintAABB,
  footprintAABBFrom,
  movingFootprintAnchors,
  refineGuidesToGap,
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

describe('collectAlignmentCandidates', () => {
  beforeEach(() => nodeRegistry._reset())

  test('excludes the moving node and skips footprintless kinds', () => {
    registerNode(floorPlacedDef('box'))
    registerNode(plainDef('wall'))
    const nodes = {
      moving: node({ id: 'moving', type: 'box', position: [0, 0, 0], dimensions: [1, 1, 1] }),
      other: node({ id: 'other', type: 'box', position: [5, 0, 5], dimensions: [1, 1, 1] }),
      wall: node({ id: 'wall', type: 'wall', position: [2, 0, 2] }),
    }
    const anchors = collectAlignmentCandidates(nodes, 'moving')
    // Only `other` contributes — 4 corner anchors (edges only), none from the
    // moving node or the wall.
    expect(anchors).toHaveLength(4)
    expect(anchors.every((a) => a.nodeId === 'other')).toBe(true)
    expect(anchors.every((a) => a.kind === 'corner')).toBe(true)
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

describe('collectFloorFootprints', () => {
  beforeEach(() => nodeRegistry._reset())

  test('maps floor-placed nodes by id, excluding the moving node and plain kinds', () => {
    registerNode(floorPlacedDef('box'))
    registerNode(plainDef('wall'))
    const nodes = {
      moving: node({ id: 'moving', type: 'box', position: [0, 0, 0], dimensions: [1, 1, 1] }),
      other: node({ id: 'other', type: 'box', position: [5, 0, 5], dimensions: [2, 1, 4] }),
      wall: node({ id: 'wall', type: 'wall', position: [2, 0, 2] }),
    }
    const map = collectFloorFootprints(nodes, 'moving')
    expect([...map.keys()]).toEqual(['other'])
    expect(map.get('other')).toEqual({ minX: 4, minZ: 3, maxX: 6, maxZ: 7 })
  })
})

describe('refineGuidesToGap', () => {
  const guideX = (coord: number, candidateNodeId: string): AlignmentGuide => ({
    axis: 'x',
    coord,
    from: { x: coord, z: 0 },
    to: { x: coord, z: 0 },
    movingAnchorKind: 'edge-mid',
    candidateAnchorKind: 'edge-mid',
    candidateNodeId,
    distance: 0,
  })

  test('measures the gap between nearest facing edges, not anchor-to-anchor', () => {
    // Moving sits past the candidate along Z; gap is moving.minZ − candidate.maxZ.
    const moving: FootprintAABB = { minX: 0, minZ: 3, maxX: 2, maxZ: 5 }
    const footprints = new Map<string, FootprintAABB>([
      ['c', { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }],
    ])
    const [g] = refineGuidesToGap([guideX(1, 'c')], moving, footprints)
    expect(g!.distance).toBeCloseTo(1, 10) // 3 − 2, not center-to-center (4)
    expect(g!.from.z).toBeCloseTo(2, 10) // candidate near edge
    expect(g!.to.z).toBeCloseTo(3, 10) // moving near edge
  })

  test('overlapping footprints have zero gap and span the union', () => {
    const moving: FootprintAABB = { minX: 0, minZ: 1, maxX: 2, maxZ: 3 }
    const footprints = new Map<string, FootprintAABB>([
      ['c', { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }],
    ])
    const [g] = refineGuidesToGap([guideX(1, 'c')], moving, footprints)
    expect(g!.distance).toBe(0)
    expect(g!.from.z).toBeCloseTo(0, 10)
    expect(g!.to.z).toBeCloseTo(3, 10)
  })

  test('passes guides through unchanged when the candidate is absent', () => {
    const moving: FootprintAABB = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }
    const original = guideX(1, 'missing')
    const [g] = refineGuidesToGap([original], moving, new Map())
    expect(g).toEqual(original)
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
