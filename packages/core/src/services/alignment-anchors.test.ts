import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry'
import type { AnyNodeDefinition } from '../registry/types'
import type { AnyNode } from '../schema/types'
import {
  getElevatorShaftDepth,
  getElevatorShaftWallThickness,
  getElevatorShaftWidth,
} from '../systems/elevator/elevator-geometry'
import { stairFootprintAABB } from '../systems/stair/stair-footprint'
import {
  collectAlignmentAnchors,
  footprintAABB,
  footprintAABBFrom,
  movingAlignmentAnchors,
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

// Mirrors the real elevator/stair definitions, which expose their plan
// footprint via the `alignmentFootprint` capability rather than a hardcoded
// branch in the anchor bridge. The glue (shaft-outset box / stair AABB) is
// reproduced here from the same core helpers production uses.
function elevatorDef(): AnyNodeDefinition {
  return {
    kind: 'elevator',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('elevator') }) as any,
    category: 'structure',
    defaults: () => ({}) as any,
    capabilities: {
      alignmentFootprint: (n: AnyNode) => {
        const e = n as any
        const wall = getElevatorShaftWallThickness(e)
        return {
          shape: 'box',
          dimensions: [getElevatorShaftWidth(e) + wall * 2, 1, getElevatorShaftDepth(e) + wall * 2],
          rotation: [0, e.rotation ?? 0, 0],
        }
      },
    },
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition
}

function stairDef(): AnyNodeDefinition {
  return {
    kind: 'stair',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('stair') }) as any,
    category: 'structure',
    defaults: () => ({}) as any,
    capabilities: {
      alignmentFootprint: (n: AnyNode, nodes?: Readonly<Record<string, AnyNode>>) => {
        const aabb = stairFootprintAABB(n as any, nodes)
        return aabb ? { shape: 'aabb', ...aabb } : null
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

  test('derives an elevator footprint from its OUTER SHAFT, not the cab', () => {
    // Aligns to the visible shaft outline: cab 2×4 + 0.09 m wall each side →
    // 2.18 × 4.18, centred at (10, 20). The cab corners alone would sit ~9 cm
    // inside the drawn edge (past the 8 cm snap), so a guide never appeared.
    // The footprint comes from the elevator's `alignmentFootprint` (box) cap.
    registerNode(elevatorDef())
    const aabb = footprintAABB(
      node({ id: 'e1', type: 'elevator', position: [10, 0, 20], width: 2, depth: 4, rotation: 0 }),
    )
    expect(aabb).toEqual({ minX: 8.91, minZ: 17.91, maxX: 11.09, maxZ: 22.09 })
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

describe('movingAlignmentAnchors', () => {
  beforeEach(() => nodeRegistry._reset())

  test('relocates a straight stair by its segment-chain footprint', () => {
    registerNode(stairDef())
    const nodes = {
      st: node({
        id: 'st',
        type: 'stair',
        position: [0, 0, 0],
        rotation: 0,
        stairType: 'straight',
        width: 1,
        children: ['seg'],
      }),
      seg: node({
        id: 'seg',
        type: 'stair-segment',
        parentId: 'st',
        width: 1,
        length: 3,
        height: 2.5,
        attachmentSide: 'front',
      }),
    }

    const anchors = movingAlignmentAnchors(nodes.st, nodes, 10, 20, 0)
    expect(anchors).toHaveLength(4)
    expect(new Set(anchors.map((a) => a.x))).toEqual(new Set([9.5, 10.5]))
    expect(new Set(anchors.map((a) => a.z))).toEqual(new Set([20, 23]))
  })

  test('rotation override drives a moving straight stair footprint', () => {
    registerNode(stairDef())
    const nodes = {
      st: node({
        id: 'st',
        type: 'stair',
        position: [0, 0, 0],
        rotation: 0,
        stairType: 'straight',
        width: 1,
        children: ['seg'],
      }),
      seg: node({
        id: 'seg',
        type: 'stair-segment',
        parentId: 'st',
        width: 1,
        length: 3,
        height: 2.5,
        attachmentSide: 'front',
      }),
    }

    const anchors = movingAlignmentAnchors(nodes.st, nodes, 10, 20, Math.PI / 2)
    const xs = anchors.map((a) => a.x)
    const zs = anchors.map((a) => a.z)
    expect(Math.min(...xs)).toBeCloseTo(10, 10)
    expect(Math.max(...xs)).toBeCloseTo(13, 10)
    expect(Math.min(...zs)).toBeCloseTo(19.5, 10)
    expect(Math.max(...zs)).toBeCloseTo(20.5, 10)
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

  test('adds ±thickness/2 face corners on each endpoint when thickness is given', () => {
    // Horizontal wall along +X: perpendicular is ±Z, so faces sit at z = ±0.1.
    const anchors = wallSegmentAnchors('w', [0, 0], [4, 0], 0.2)
    expect(anchors).toEqual([
      { nodeId: 'w', kind: 'corner', x: 0, z: 0 },
      { nodeId: 'w', kind: 'corner', x: 4, z: 0 },
      { nodeId: 'w', kind: 'center', x: 2, z: 0 },
      { nodeId: 'w', kind: 'corner', x: 0, z: 0.1 },
      { nodeId: 'w', kind: 'corner', x: 0, z: -0.1 },
      { nodeId: 'w', kind: 'corner', x: 4, z: 0.1 },
      { nodeId: 'w', kind: 'corner', x: 4, z: -0.1 },
    ])
  })

  test('skips face corners for zero/degenerate input', () => {
    expect(wallSegmentAnchors('w', [0, 0], [4, 0], 0)).toHaveLength(3)
    expect(wallSegmentAnchors('w', [1, 1], [1, 1], 0.2)).toHaveLength(3)
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
    expect(ids.filter((id) => id === 'wall')).toHaveLength(7) // endpoints + midpoint + 4 face corners
    expect(ids.filter((id) => id === 'slab')).toHaveLength(3) // polygon vertices
  })

  test('levelId filter keeps only nodes resolving to that level (incl. nested)', () => {
    registerNode(floorPlacedDef('box'))
    registerNode(elevatorDef())
    const nodes = {
      b: node({ id: 'b', type: 'building' }),
      L1: node({ id: 'L1', type: 'level', parentId: 'b' }),
      L2: node({ id: 'L2', type: 'level', parentId: 'b' }),
      moving: node({ id: 'moving', type: 'box', parentId: 'L1', position: [0, 0, 0] }),
      sameFloor: node({ id: 'sameFloor', type: 'box', parentId: 'L1', position: [5, 0, 5] }),
      // Item resting on `sameFloor` — resolves to L1 through the parent chain.
      nested: node({ id: 'nested', type: 'box', parentId: 'sameFloor', position: [5, 0, 5] }),
      otherFloor: node({ id: 'otherFloor', type: 'box', parentId: 'L2', position: [5, 0, 5] }),
      // Building-scoped (parented to the building, no level ancestor) — spans
      // every floor, so it stays in the pool regardless of the active level.
      elevator: node({
        id: 'elevator',
        type: 'elevator',
        parentId: 'b',
        position: [9, 0, 9],
        width: 1.6,
        depth: 1.6,
      }),
    }
    const ids = collectAlignmentAnchors(nodes, 'moving', 'L1').map((a) => a.nodeId)
    expect(ids.filter((id) => id === 'sameFloor')).toHaveLength(4)
    expect(ids.filter((id) => id === 'nested')).toHaveLength(4)
    expect(ids.filter((id) => id === 'elevator')).toHaveLength(4)
    expect(ids).not.toContain('otherFloor')
  })

  test('straight stair contributes its segment-chain footprint corners', () => {
    registerNode(stairDef())
    const nodes = {
      st: node({
        id: 'st',
        type: 'stair',
        position: [0, 0, 0],
        rotation: 0,
        stairType: 'straight',
        width: 1,
        children: ['seg'],
      }),
      // Single 1×3 flight; origin at the run start, extending +Z by length.
      seg: node({
        id: 'seg',
        type: 'stair-segment',
        parentId: 'st',
        width: 1,
        length: 3,
        height: 2.5,
        attachmentSide: 'front',
      }),
    }
    const anchors = collectAlignmentAnchors(nodes, '').filter((a) => a.nodeId === 'st')
    expect(anchors).toHaveLength(4)
    expect(anchors.every((a) => a.kind === 'corner')).toBe(true)
    expect(new Set(anchors.map((a) => a.x))).toEqual(new Set([-0.5, 0.5]))
    expect(new Set(anchors.map((a) => a.z))).toEqual(new Set([0, 3]))
  })

  test('curved stair contributes its sector bounding-box corners', () => {
    registerNode(stairDef())
    const nodes = {
      cs: node({
        id: 'cs',
        type: 'stair',
        position: [0, 0, 0],
        rotation: 0,
        stairType: 'curved',
        width: 1,
        innerRadius: 1,
        sweepAngle: Math.PI / 2,
      }),
    }
    const anchors = collectAlignmentAnchors(nodes, '').filter((a) => a.nodeId === 'cs')
    expect(anchors).toHaveLength(4)
    // outerRadius = inner(1) + width(1) = 2, sweep π/2 centred on +X. Outer rim
    // reaches X=2 at the bisector; min X is the inner rim's ±π/4 ends (cos45·1);
    // Z spans ±(outer·sin45).
    const xs = anchors.map((a) => a.x)
    const zs = anchors.map((a) => a.z)
    expect(Math.max(...xs)).toBeCloseTo(2, 5)
    expect(Math.min(...xs)).toBeCloseTo(Math.SQRT1_2, 5)
    expect(Math.max(...zs)).toBeCloseTo(Math.SQRT2, 5)
    expect(Math.min(...zs)).toBeCloseTo(-Math.SQRT2, 5)
  })

  test('spiral stair contributes a full-circle bounding box', () => {
    registerNode(stairDef())
    const nodes = {
      sp: node({
        id: 'sp',
        type: 'stair',
        position: [5, 0, 5],
        rotation: 0,
        stairType: 'spiral',
        width: 1,
        innerRadius: 0.5,
        sweepAngle: Math.PI * 2,
      }),
    }
    const anchors = collectAlignmentAnchors(nodes, '').filter((a) => a.nodeId === 'sp')
    expect(anchors).toHaveLength(4)
    // outerRadius = inner(0.5) + width(1) = 1.5, a full revolution about (5, 5).
    const xs = anchors.map((a) => a.x)
    const zs = anchors.map((a) => a.z)
    expect(Math.max(...xs)).toBeCloseTo(6.5, 2)
    expect(Math.min(...xs)).toBeCloseTo(3.5, 2)
    expect(Math.max(...zs)).toBeCloseTo(6.5, 2)
    expect(Math.min(...zs)).toBeCloseTo(3.5, 2)
  })
})
