import { describe, expect, test } from 'bun:test'
import { type GeometryContext, rampFacts } from '@pascal-app/core'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { RampNode } from '@pascal-app/core/schema'
import { buildRampFloorplan, buildRampRibbonGeometry } from '@pascal-app/nodes'
import { type BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'

function ramp(overrides: Partial<RampNode> = {}): RampNode {
  return RampNode.parse({
    id: 'ramp_geometry',
    parentId: 'site_geometry',
    start: [0, 0],
    segments: [{ type: 'line', end: [20, 0] }],
    width: 4,
    startHeight: 4,
    endHeight: 0.8,
    thickness: 0.25,
    startTransition: 0,
    endTransition: 0,
    retainingHeight: 0,
    terrainMode: 'none',
    ...overrides,
  })
}

function vertices(geometry: BufferGeometry): [number, number, number][] {
  const position = geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, index) => [
    position.getX(index),
    position.getY(index),
    position.getZ(index),
  ])
}

// These assertions observe the solid, not a tessellation, vertex order or material implementation.
// A linear ramp has an analytical top plane; the thickness extends vertically downward from it.
describe('ramp solid ribbon', () => {
  test('rejects a non-tangent joint while constructing ramp facts and ribbon geometry', () => {
    const node = ramp({
      start: [0, 0],
      segments: [
        { type: 'line', end: [10, 0] },
        {
          type: 'line',
          end: [10 + 10 * Math.cos((20 * Math.PI) / 180), 10 * Math.sin((20 * Math.PI) / 180)],
        },
      ],
      startHeight: 0,
      endHeight: 2,
      startTransition: 0,
      endTransition: 0,
      maxSlopePercent: 18,
    })
    for (const create of [() => rampFacts(node, {}), () => buildRampRibbonGeometry(node)]) {
      try {
        create()
        throw new Error('expected non-tangent joint refusal')
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        expect(error.code).toBe('ramp_joint_not_tangent')
        expect(error.details).toMatchObject({
          jointIndex: 1,
          toleranceRadians: 1e-6,
        })
        expect(error.details?.angleDegrees).toBeCloseTo(20, 9)
      }
    }
  })

  test('accepts a straight two-segment centreline', () => {
    const geometry = buildRampRibbonGeometry(
      ramp({
        segments: [
          { type: 'line', end: [10, 0] },
          { type: 'line', end: [20, 0] },
        ],
      }),
    )
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.x).toBeCloseTo(0, 8)
    expect(geometry.boundingBox?.max.x).toBeCloseTo(20, 8)
    geometry.dispose()
  })

  test('a 1100 m accepted ramp has a complete ribbon and floorplan at default resolution', () => {
    const node = ramp({
      segments: [{ type: 'line', end: [1100, 0] }],
      startHeight: 0,
      endHeight: 110,
    })
    const geometry = buildRampRibbonGeometry(node)
    try {
      geometry.computeBoundingBox()
      expect(geometry.boundingBox?.min.x).toBeCloseTo(0, 5)
      expect(geometry.boundingBox?.max.x).toBeCloseTo(1100, 5)
      expect(geometry.boundingBox?.min.y).toBeCloseTo(-0.25, 5)
      expect(geometry.boundingBox?.max.y).toBeCloseTo(110, 5)
      const context = {
        resolve: () => undefined,
        parent: null,
        children: [],
        siblings: [],
      } satisfies GeometryContext
      const plan = buildRampFloorplan(node, context)
      if (plan?.kind !== 'group') throw new Error('The long ramp has no floorplan')
      const outline = plan.children.find((child) => child.kind === 'polygon')
      if (outline?.kind !== 'polygon') throw new Error('The long ramp has no floorplan outline')
      expect(Math.min(...outline.points.map(([x]) => x))).toBeCloseTo(0, 5)
      expect(Math.max(...outline.points.map(([x]) => x))).toBeCloseTo(1100, 5)
      expect(Math.min(...outline.points.map(([, z]) => z))).toBeCloseTo(-2, 5)
      expect(Math.max(...outline.points.map(([, z]) => z))).toBeCloseTo(2, 5)
    } finally {
      geometry.dispose()
    }
  })

  test('the rendered top includes the entry and exit grade transitions', () => {
    const geometry = buildRampRibbonGeometry(ramp({ startTransition: 2, endTransition: 6 }))
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material)
    try {
      mesh.updateMatrixWorld(true)
      for (const [distance, height] of [
        [2, 3.8],
        [10, 2.2],
        [14, 1.4],
      ] as const) {
        const ray = new Raycaster(new Vector3(distance, 10, 0), new Vector3(0, -1, 0))
        const top = ray.intersectObject(mesh)[0]
        if (!top) throw new Error(`The ramp has no surface at distance ${distance}`)
        expect(top.point.y).toBeCloseTo(height, 3)
      }
    } finally {
      geometry.dispose()
      material.dispose()
    }
  })

  test('keeps the requested width, both endpoint elevations and downward thickness', () => {
    const geometry = buildRampRibbonGeometry(ramp())
    try {
      const points = vertices(geometry)
      expect(points.length).toBeGreaterThan(0)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox?.min.x).toBeCloseTo(0, 5)
      expect(geometry.boundingBox?.max.x).toBeCloseTo(20, 5)
      expect(geometry.boundingBox?.min.z).toBeCloseTo(-2, 5)
      expect(geometry.boundingBox?.max.z).toBeCloseTo(2, 5)
      expect(geometry.boundingBox?.min.y).toBeCloseTo(0.55, 5)
      expect(geometry.boundingBox?.max.y).toBeCloseTo(4, 5)
      for (const [x, y, z] of points) {
        const top = 4 - 0.16 * x
        expect(Number.isFinite(x + y + z)).toBe(true)
        expect(y).toBeLessThanOrEqual(top + 0.00001)
        expect(y).toBeGreaterThanOrEqual(top - 0.25001)
      }
      for (const [x, y] of [
        [0, 4],
        [20, 0.8],
      ] as const) {
        for (const z of [-2, 2]) {
          for (const height of [y, y - 0.25]) {
            expect(
              points.some(
                (point) =>
                  Math.abs(point[0] - x) < 0.00001 &&
                  Math.abs(point[1] - height) < 0.00001 &&
                  Math.abs(point[2] - z) < 0.00001,
              ),
            ).toBe(true)
          }
        }
      }
    } finally {
      geometry.dispose()
    }
  })

  test('a three-quarter spiral is an annular strip, not a fan filling the centre', () => {
    const geometry = buildRampRibbonGeometry(
      ramp({
        start: [10, 0],
        segments: [{ type: 'arc', center: [0, 0], sweep: (3 * Math.PI) / 2 }],
        startHeight: 4,
        endHeight: 1,
      }),
    )
    try {
      const points = vertices(geometry)
      expect(points.length).toBeGreaterThan(0)
      for (const [x, y, z] of points) {
        expect(Number.isFinite(x + y + z)).toBe(true)
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(7.99999)
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(12.00001)
        expect(y).toBeGreaterThanOrEqual(0.74999)
        expect(y).toBeLessThanOrEqual(4.00001)
      }
      for (const [x, z, height] of [
        [8, 0, 4],
        [12, 0, 4],
        [0, -8, 1],
        [0, -12, 1],
      ] as const) {
        expect(
          points.some(
            ([px, py, pz]) =>
              Math.abs(px - x) < 0.00001 &&
              Math.abs(py - height) < 0.00001 &&
              Math.abs(pz - z) < 0.00001,
          ),
        ).toBe(true)
      }
      const position = geometry.getAttribute('position')
      const index = geometry.getIndex()
      const count = index?.count ?? position.count
      expect(count % 3).toBe(0)
      for (let offset = 0; offset < count; offset += 3) {
        const triangle = [0, 1, 2].map((corner) => {
          const vertex = index ? index.getX(offset + corner) : offset + corner
          return [position.getX(vertex), position.getZ(vertex)] as const
        })
        const x = triangle.reduce((sum, point) => sum + point[0], 0) / 3
        const z = triangle.reduce((sum, point) => sum + point[1], 0) / 3
        // 0.1 m chord allowance accommodates a different valid station tessellation.
        expect(Math.hypot(x, z)).toBeGreaterThan(7.9)
      }
    } finally {
      geometry.dispose()
    }
  })
})
