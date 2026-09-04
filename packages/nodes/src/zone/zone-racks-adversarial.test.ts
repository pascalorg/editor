import { describe, expect, it } from 'bun:test'
import type { AnyNode, ZoneNode } from '@pascal-app/core'
import { calculateZoneProjection, deriveZoneRackFootprints } from './zone-racks'

describe('R1 Adversarial & Stress Verification: 2D Minimap Racks', () => {
  // ── 1. Non-Orthogonal Rotations & Trigonometric Invariants ───────────────
  it('preserves Euclidean lengths, orthogonality, diagonals, and area across arbitrary non-orthogonal angles', () => {
    const W = 2.944 // 2.7 + 2 * 0.122
    const D = 1.1
    const expectedDiag = Math.hypot(W, D)
    const expectedArea = W * D

    const testAngles = [
      0,
      Math.PI / 6, // 30 deg
      Math.PI / 4, // 45 deg
      Math.PI / 3, // 60 deg
      Math.PI / 2, // 90 deg
      (2 * Math.PI) / 3, // 120 deg
      (3 * Math.PI) / 4, // 135 deg
      (5 * Math.PI) / 6, // 150 deg
      Math.PI, // 180 deg
      (7 * Math.PI) / 6, // 210 deg
      (5 * Math.PI) / 4, // 225 deg
      (4 * Math.PI) / 3, // 240 deg
      (3 * Math.PI) / 2, // 270 deg
      (7 * Math.PI) / 4, // 315 deg
      (11 * Math.PI) / 6, // 330 deg
      2.34567, // arbitrary radians
      -1.23456, // negative radians
      100 * Math.PI + 0.5, // multiple full revolutions
    ]

    const zone: ZoneNode = {
      id: 'zone-adv-rot',
      type: 'zone',
      name: 'Adversarial Rotation Zone',
      polygon: [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
      parentId: 'level-1',
    }

    for (const rotY of testAngles) {
      const rackId = `rack-rot-${rotY}`
      const nodes: Record<string, AnyNode> = {
        [rackId]: {
          id: rackId,
          type: 'warehouse:pallet-rack',
          position: [10, 0, 10],
          rotation: [0, rotY, 0],
          parentId: 'level-1',
          bayClearWidth: 2.7,
          uprightWidth: 0.122,
          depth: 1.1,
          depthPositions: 1,
        } as unknown as AnyNode,
      }

      const footprints = deriveZoneRackFootprints(nodes, zone)
      expect(footprints).toHaveLength(1)
      const fp = footprints[0]!

      expect(fp.worldCorners).toBeDefined()
      const [c0, c1, c2, c3] = fp.worldCorners!

      // 1. Edge lengths
      const edge0 = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) // width
      const edge1 = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) // depth
      const edge2 = Math.hypot(c3[0] - c2[0], c3[1] - c2[1]) // width
      const edge3 = Math.hypot(c0[0] - c3[0], c0[1] - c3[1]) // depth

      expect(Math.abs(edge0 - W)).toBeLessThan(1e-4)
      expect(Math.abs(edge1 - D)).toBeLessThan(1e-4)
      expect(Math.abs(edge2 - W)).toBeLessThan(1e-4)
      expect(Math.abs(edge3 - D)).toBeLessThan(1e-4)

      // 2. Diagonals
      const diag0 = Math.hypot(c2[0] - c0[0], c2[1] - c0[1])
      const diag1 = Math.hypot(c3[0] - c1[0], c3[1] - c1[1])
      expect(Math.abs(diag0 - expectedDiag)).toBeLessThan(1e-4)
      expect(Math.abs(diag1 - expectedDiag)).toBeLessThan(1e-4)

      // 3. Orthogonality (Dot product of adjacent vectors c1-c0 and c2-c1)
      const v01 = [c1[0] - c0[0], c1[1] - c0[1]]
      const v12 = [c2[0] - c1[0], c2[1] - c1[1]]
      const dotProduct = v01[0] * v12[0] + v01[1] * v12[1]
      expect(Math.abs(dotProduct)).toBeLessThan(1e-4)

      // 4. Area invariance (Shoelace)
      const pts = [c0, c1, c2, c3]
      let area = 0
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4
        area += pts[i]![0] * pts[next]![1] - pts[next]![0] * pts[i]![1]
      }
      area = Math.abs(area) / 2
      expect(Math.abs(area - expectedArea)).toBeLessThan(1e-4)
    }
  })

  // ── 2. Extreme Coordinate Ranges & Numerical Stability ───────────────────
  it('handles extreme GIS coordinates, negative spans, and micro-dimensions without overflow or NaN', () => {
    // Gigantic coordinates (GIS / large logistics park)
    const giantOffset = 10_000_000
    const giantZone: ZoneNode = {
      id: 'zone-giant',
      type: 'zone',
      polygon: [
        [giantOffset + 0, giantOffset + 0],
        [giantOffset + 1000, giantOffset + 0],
        [giantOffset + 1000, giantOffset + 800],
        [giantOffset + 0, giantOffset + 800],
      ],
      parentId: 'level-gis',
    }

    const giantNodes: Record<string, AnyNode> = {
      'giant-rack-1': {
        id: 'giant-rack-1',
        type: 'warehouse:pallet-rack',
        position: [giantOffset + 500, 0, giantOffset + 400],
        rotation: [0, 0.785, 0],
        parentId: 'level-gis',
        width: 3.0,
        depth: 1.2,
      } as unknown as AnyNode,
    }

    const proj = calculateZoneProjection(giantZone.polygon, 276, 176, 34)
    expect(Number.isFinite(proj.scale)).toBe(true)
    expect(proj.scale).toBeGreaterThan(0)
    expect(Number.isFinite(proj.offsetX)).toBe(true)
    expect(Number.isFinite(proj.offsetY)).toBe(true)

    const footprints = deriveZoneRackFootprints(giantNodes, giantZone, proj)
    expect(footprints).toHaveLength(1)
    for (const pt of footprints[0]!.points) {
      expect(Number.isFinite(pt[0])).toBe(true)
      expect(Number.isFinite(pt[1])).toBe(true)
      // Must reside within the 276x176 SVG canvas viewport
      expect(pt[0]).toBeGreaterThanOrEqual(0)
      expect(pt[0]).toBeLessThanOrEqual(276)
      expect(pt[1]).toBeGreaterThanOrEqual(0)
      expect(pt[1]).toBeLessThanOrEqual(176)
    }

    // Negative coordinate space
    const negativeZone: ZoneNode = {
      id: 'zone-neg',
      type: 'zone',
      polygon: [
        [-500, -300],
        [-100, -300],
        [-100, -100],
        [-500, -100],
      ],
      parentId: 'level-neg',
    }
    const negativeNodes: Record<string, AnyNode> = {
      'neg-rack': {
        id: 'neg-rack',
        type: 'warehouse:longspan-rack',
        position: [-300, 0, -200],
        parentId: 'level-neg',
        bayLength: 2.0,
        frameDepth: 0.8,
      } as unknown as AnyNode,
    }
    const negFootprints = deriveZoneRackFootprints(negativeNodes, negativeZone)
    expect(negFootprints).toHaveLength(1)
    for (const pt of negFootprints[0]!.points) {
      expect(Number.isFinite(pt[0])).toBe(true)
      expect(Number.isFinite(pt[1])).toBe(true)
      expect(pt[0]).toBeGreaterThan(0)
      expect(pt[0]).toBeLessThan(276)
      expect(pt[1]).toBeGreaterThan(0)
      expect(pt[1]).toBeLessThan(176)
    }
  })

  // ── 3. Degenerate Geometries & Edge Boundary Conditions ──────────────────
  it('handles degenerate zone polygons, invalid dimensions, and malformed node inputs safely', () => {
    // Degenerate zone polygons
    const emptyZone: ZoneNode = { id: 'z-empty', type: 'zone', polygon: [] }
    const singlePointZone: ZoneNode = { id: 'z-1pt', type: 'zone', polygon: [[10, 10]] }
    const collinearZone: ZoneNode = {
      id: 'z-collinear',
      type: 'zone',
      polygon: [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
    }

    const testNode: Record<string, AnyNode> = {
      rack1: {
        id: 'rack1',
        type: 'warehouse:pallet-rack',
        position: [5, 0, 5],
      } as unknown as AnyNode,
    }

    expect(deriveZoneRackFootprints(testNode, emptyZone)).toEqual([])
    expect(deriveZoneRackFootprints(testNode, singlePointZone)).toEqual([])
    expect(deriveZoneRackFootprints(testNode, collinearZone)).toEqual([])
    expect(deriveZoneRackFootprints(undefined, undefined)).toEqual([])

    // Malformed rack nodes
    const validZone: ZoneNode = {
      id: 'z-valid',
      type: 'zone',
      polygon: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
    }

    const malformedNodes: Record<string, AnyNode> = {
      // Missing position
      noPos: { id: 'noPos', type: 'warehouse:pallet-rack' } as unknown as AnyNode,
      // NaN in position
      nanPos: {
        id: 'nanPos',
        type: 'warehouse:pallet-rack',
        position: [Number.NaN, 0, 10],
      } as unknown as AnyNode,
      // Infinite position
      infPos: {
        id: 'infPos',
        type: 'warehouse:pallet-rack',
        position: [10, 0, Number.POSITIVE_INFINITY],
      } as unknown as AnyNode,
      // Zero width & depth
      zeroDim: {
        id: 'zeroDim',
        type: 'warehouse:pallet-rack',
        position: [10, 0, 10],
        width: 0,
        depth: 0,
      } as unknown as AnyNode,
      // Negative dimensions
      negDim: {
        id: 'negDim',
        type: 'warehouse:pallet-rack',
        position: [10, 0, 10],
        width: -2,
        depth: -1,
      } as unknown as AnyNode,
      // Fabric nodes (should be ignored)
      wallNode: {
        id: 'wall1',
        type: 'wall',
        position: [10, 0, 10],
      } as unknown as AnyNode,
      slabNode: {
        id: 'slab1',
        type: 'slab',
        position: [10, 0, 10],
      } as unknown as AnyNode,
      // Valid rack
      validRack: {
        id: 'validRack',
        type: 'warehouse:pallet-rack',
        position: [10, 0, 10],
        width: 2.7,
        depth: 1.1,
      } as unknown as AnyNode,
    }

    const results = deriveZoneRackFootprints(malformedNodes, validZone)
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('validRack')
  })

  // ── 4. SVG Polygon Formatting & Closure Oracle ───────────────────────────
  it('formats SVG polygon points as valid, closed, non-self-intersecting quadrilaterals', () => {
    const zone: ZoneNode = {
      id: 'z-svg',
      type: 'zone',
      polygon: [
        [0, 0],
        [30, 0],
        [30, 30],
        [0, 30],
      ],
    }

    const nodes: Record<string, AnyNode> = {
      r1: {
        id: 'r1',
        type: 'warehouse:drive-in-rack',
        position: [15, 0, 15],
        rotation: [0, 0.45, 0],
        laneClearWidth: 1.4,
        palletsDeep: 3,
        uprightWidth: 0.12,
      } as unknown as AnyNode,
    }

    const footprints = deriveZoneRackFootprints(nodes, zone)
    expect(footprints).toHaveLength(1)
    const fp = footprints[0]!

    // Verify exactly 4 points
    expect(fp.points).toHaveLength(4)

    // Formatted SVG points string simulation as in quantities-panel.tsx:
    // points={rack.points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ')}
    const svgPointsString = fp.points
      .map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`)
      .join(' ')

    // Regex check: 4 pairs of numbers separated by comma and spaces
    const svgPointsRegex = /^(-?\d+\.\d{2},-?\d+\.\d{2}\s+){3}-?\d+\.\d{2},-?\d+\.\d{2}$/
    expect(svgPointsRegex.test(svgPointsString)).toBe(true)

    // Convexity & non-self-intersection test via 2D cross products of consecutive edges
    const pts = fp.points
    let initialCrossSign = 0
    for (let i = 0; i < 4; i++) {
      const p0 = pts[i]!
      const p1 = pts[(i + 1) % 4]!
      const p2 = pts[(i + 2) % 4]!
      const cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
      const sign = Math.sign(cross)
      if (initialCrossSign === 0) {
        initialCrossSign = sign
      } else {
        // All edge turn signs must match for a non-self-intersecting convex polygon
        expect(sign).toBe(initialCrossSign)
      }
    }
  })

  // ── 5. High-Density Stress Performance Benchmark ─────────────────────────
  it('processes 2,000 warehouse racks in a mega-distribution zone in < 50ms', () => {
    const zone: ZoneNode = {
      id: 'mega-zone',
      type: 'zone',
      polygon: [
        [0, 0],
        [500, 0],
        [500, 500],
        [0, 500],
      ],
      parentId: 'level-mega',
    }

    const megaNodes: Record<string, AnyNode> = {}
    const count = 2000
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 50)
      const col = i % 50
      const id = `rack-${i}`
      megaNodes[id] = {
        id,
        type: i % 2 === 0 ? 'warehouse:pallet-rack' : 'warehouse:drive-in-rack',
        position: [10 + col * 9.5, 0, 10 + row * 9.5],
        rotation: [0, (i * 0.1) % Math.PI, 0],
        parentId: 'level-mega',
        width: 2.8,
        depth: 1.1,
      } as unknown as AnyNode
    }

    const startTime = performance.now()
    const footprints = deriveZoneRackFootprints(megaNodes, zone)
    const elapsed = performance.now() - startTime

    expect(footprints.length).toBe(count)
    expect(elapsed).toBeLessThan(50) // Must execute under 50ms for 2,000 nodes
  })
})
