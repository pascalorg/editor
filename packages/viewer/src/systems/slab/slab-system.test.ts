// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { getSlabElevationAtPoint, SlabNode, type SlabPolygonContext } from '@pascal-app/core'
import type * as THREE from 'three'
import { buildTerrainPerimeterFillGeometry } from '../../lib/terrain-perimeter-fill'
import { generateSlabGeometry } from './slab-system'

const EMPTY_CONTEXT: SlabPolygonContext = { walls: [], siblingSlabs: [] }

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function hasVertexAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(positions.getX(index) - x) < 1e-6 && Math.abs(positions.getZ(index) - z) < 1e-6) {
      return true
    }
  }
  return false
}

function uniqueSortedYs(geometry: THREE.BufferGeometry): number[] {
  const positions = geometry.getAttribute('position')
  const ys = new Set<number>()
  for (let index = 0; index < positions.count; index += 1) {
    ys.add(Math.round(positions.getY(index) * 1e4) / 1e4)
  }
  return [...ys].sort((a, b) => a - b)
}

describe('generateSlabGeometry', () => {
  test('renders a boundary-overlapping hole as an open indentation', () => {
    const slab = SlabNode.parse({
      elevation: 0.05,
      polygon: SQUARE,
      holes: [
        [
          [1, -0.5],
          [3, -0.5],
          [3, 1],
          [1, 1],
        ],
      ],
    })

    const geometry = generateSlabGeometry(slab, EMPTY_CONTEXT)

    expect((geometry.index?.count ?? 0) / 3).toBeGreaterThan(0)
    expect(hasVertexAt(geometry, 1, 1)).toBe(true)
    expect(hasVertexAt(geometry, 3, 1)).toBe(true)
  })

  test('renders a boundary-overlapping hole as an open indentation on recessed slabs', () => {
    const slab = SlabNode.parse({
      elevation: -0.2,
      recessed: true,
      polygon: SQUARE,
      holes: [
        [
          [1, -0.5],
          [3, -0.5],
          [3, 1],
          [1, 1],
        ],
      ],
    })

    const geometry = generateSlabGeometry(slab, EMPTY_CONTEXT)

    expect((geometry.index?.count ?? 0) / 3).toBeGreaterThan(0)
    expect(hasVertexAt(geometry, 1, 1)).toBe(true)
    expect(hasVertexAt(geometry, 3, 1)).toBe(true)
  })

  test('solid slab occupies [elevation − thickness, elevation]', () => {
    const slab = SlabNode.parse({ elevation: 0.3, thickness: 0.1, polygon: SQUARE })

    const ys = uniqueSortedYs(generateSlabGeometry(slab, EMPTY_CONTEXT))

    expect(ys).toEqual([0.2, 0.3])
  })

  test('migrated legacy slab (thickness = elevation) reproduces the [0, elevation] extrusion', () => {
    const slab = SlabNode.parse({ elevation: 0.05, thickness: 0.05, polygon: SQUARE })

    const geometry = generateSlabGeometry(slab, EMPTY_CONTEXT)

    // Old-style expectations: extrude-from-zero put the bottom cap at 0 and
    // the top cap at `elevation`, with 8 cap verts + 4 side quads (16 verts)
    // and 12 triangles for a plain quad slab.
    expect(uniqueSortedYs(geometry)).toEqual([0, 0.05])
    expect(geometry.getAttribute('position').count).toBe(24)
    expect((geometry.index?.count ?? 0) / 3).toBe(12)
    for (const [x, z] of SQUARE) {
      expect(hasVertexAt(geometry, x, z)).toBe(true)
    }
  })

  test('recess is keyed by the flag, not the elevation sign', () => {
    const belowPlaneSolid = SlabNode.parse({ elevation: -0.2, thickness: 0.05, polygon: SQUARE })

    // Without `recessed`, a negative elevation is just a solid placed below
    // the level plane: closed body at [-0.25, -0.2], world-space Y baked in.
    expect(uniqueSortedYs(generateSlabGeometry(belowPlaneSolid, EMPTY_CONTEXT))).toEqual([
      -0.25, -0.2,
    ])

    // The recessed shell is authored at local Y=0 (floor) up to |elevation|
    // (rim), with no top cap: 4 floor verts + 4 wall quads = 20 verts,
    // 2 floor + 8 wall triangles.
    const pool = SlabNode.parse({ elevation: -0.2, recessed: true, polygon: SQUARE })
    const poolGeometry = generateSlabGeometry(pool, EMPTY_CONTEXT)
    expect(uniqueSortedYs(poolGeometry)).toEqual([0, 0.2])
    expect(poolGeometry.getAttribute('position').count).toBe(20)
    expect((poolGeometry.index?.count ?? 0) / 3).toBe(10)
  })

  test('a zero-area polygon builds no side-wall fins', () => {
    const collinear: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 0],
    ]
    for (const recessed of [false, true]) {
      const slab = SlabNode.parse({ polygon: collinear, recessed, recessedRimElevation: 0.3 })
      const geometry = generateSlabGeometry(slab, EMPTY_CONTEXT)
      expect(geometry.getAttribute('position')?.count ?? 0).toBe(0)
    }
  })

  test('a zero-area interior hole cuts nothing and grows no hole-wall fins', () => {
    const plain = generateSlabGeometry(SlabNode.parse({ polygon: SQUARE }), EMPTY_CONTEXT)
    const sliverHole = SlabNode.parse({
      polygon: SQUARE,
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 1.0000005],
          [1, 1.0000005],
        ],
      ],
    })
    const geometry = generateSlabGeometry(sliverHole, EMPTY_CONTEXT)
    expect((geometry.index?.count ?? 0) / 3).toBe((plain.index?.count ?? 0) / 3)
  })

  test('a hole covering the whole slab leaves no triangles', () => {
    const slab = SlabNode.parse({
      polygon: SQUARE,
      holes: [
        [
          [-1, -1],
          [5, -1],
          [5, 4],
          [-1, 4],
        ],
      ],
    })
    expect((generateSlabGeometry(slab, EMPTY_CONTEXT).index?.count ?? 0) / 3).toBe(0)
  })

  test('extrudes a planar sloped solid slab with coplanar top, parallel bottom, and sloped hole walls', () => {
    const slab = SlabNode.parse({
      polygon: SQUARE,
      elevation: 0.1,
      thickness: 0.2,
      slope: { direction: 0, pitch: 15 },
      holes: [
        [
          [1, 1],
          [3, 1],
          [3, 2],
          [1, 2],
        ],
      ],
    })
    const geometry = generateSlabGeometry(slab, EMPTY_CONTEXT)
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    expect(positions.count).toBeGreaterThan(0)

    const rise = 4 * Math.tan((15 * Math.PI) / 180)
    const expectedNy = Math.cos((15 * Math.PI) / 180)
    let sawTopFace = false
    let sawHighVertex = false
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      const y = positions.getY(i)
      const z = positions.getZ(i)
      const top = getSlabElevationAtPoint(slab, x, z)
      // Every vertex sits either on the sloped top or sloped bottom plane
      const onTop = Math.abs(y - top) < 1e-5
      const onBottom = Math.abs(y - (top - 0.2)) < 1e-5
      expect(onTop || onBottom).toBe(true)
      if (Math.abs(x - 4) < 1e-5 && onTop) {
        expect(y).toBeCloseTo(0.1 + rise, 5)
        sawHighVertex = true
      }
      if (normals.getY(i) > 0.5) {
        expect(normals.getY(i)).toBeCloseTo(expectedNy, 5)
        sawTopFace = true
      }
    }
    expect(sawTopFace).toBe(true)
    expect(sawHighVertex).toBe(true)
    expect(hasVertexAt(geometry, 1, 1)).toBe(true)
    expect(hasVertexAt(geometry, 3, 2)).toBe(true)
  })

  test('buildTerrainPerimeterFillGeometry accepts per-vertex sloped top elevations', () => {
    const points = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 2 },
      { x: 0, z: 2 },
    ]
    const topY = [0.0, 0.8, 0.8, 0.0]
    const bottomY = [-0.2, -0.2, -0.2, -0.2]
    const geo = buildTerrainPerimeterFillGeometry(points, bottomY, topY, 1e-4)
    expect(geo).not.toBeNull()
    const ys = uniqueSortedYs(geo!)
    expect(ys[0]).toBeCloseTo(-0.2, 4)
    expect(ys[ys.length - 1]).toBeCloseTo(0.8, 4)
  })
})
