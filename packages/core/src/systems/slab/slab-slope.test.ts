import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SLAB_ELEVATION,
  getSlabBottomElevationAtPoint,
  getSlabElevationAtPoint,
  getSlabMaxElevation,
  getSlabSlopePlane,
  getSlabSurfaceNormal,
  hasSlabSlope,
  intersectRayWithSlabPlane,
  MAX_SLAB_SLOPE_DEGREES,
  SlabNode,
  slabSlopeEqual,
} from '../../index'

const RECT_4X2: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 2],
  [0, 2],
]

describe('SlabNode slope schema & pure plane math', () => {
  test('legacy flat slabs without slope parse unchanged (E-003)', () => {
    const slab = SlabNode.parse({ polygon: RECT_4X2 })
    expect(slab.slope).toBeUndefined()
    expect(slab.elevation).toBe(DEFAULT_SLAB_ELEVATION)
    expect(hasSlabSlope(slab)).toBe(false)
    expect(getSlabElevationAtPoint(slab, 2, 1)).toBeCloseTo(DEFAULT_SLAB_ELEVATION, 6)
    expect(getSlabMaxElevation(slab)).toBeCloseTo(DEFAULT_SLAB_ELEVATION, 6)
    expect(getSlabSurfaceNormal(slab)).toEqual([0, 1, 0])
  })

  test('validates slope bounds (0..45 degrees)', () => {
    expect(
      SlabNode.safeParse({ polygon: RECT_4X2, slope: { direction: 90, pitch: 45 } }).success,
    ).toBe(true)
    expect(
      SlabNode.safeParse({ polygon: RECT_4X2, slope: { direction: 0, pitch: -1 } }).success,
    ).toBe(false)
    expect(
      SlabNode.safeParse({
        polygon: RECT_4X2,
        slope: { direction: 0, pitch: MAX_SLAB_SLOPE_DEGREES + 1 },
      }).success,
    ).toBe(false)
  })

  test('anchors elevation at the low edge along cardinal and diagonal directions', () => {
    const pitch = 10
    const grade = Math.tan((pitch * Math.PI) / 180)
    const eastRamp = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.05,
      thickness: 0.15,
      slope: { direction: 0, pitch },
    })

    expect(hasSlabSlope(eastRamp)).toBe(true)
    expect(getSlabElevationAtPoint(eastRamp, 0, 1)).toBeCloseTo(0.05, 6)
    expect(getSlabElevationAtPoint(eastRamp, 2, 1)).toBeCloseTo(0.05 + 2 * grade, 6)
    expect(getSlabElevationAtPoint(eastRamp, 4, 1)).toBeCloseTo(0.05 + 4 * grade, 6)
    expect(getSlabBottomElevationAtPoint(eastRamp, 4, 1)).toBeCloseTo(0.05 + 4 * grade - 0.15, 6)
    expect(getSlabMaxElevation(eastRamp)).toBeCloseTo(0.05 + 4 * grade, 6)

    // Flipping direction 180° keeps the new low edge (x = 4) at elevation 0.05
    const westRamp = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.05,
      slope: { direction: 180, pitch },
    })
    expect(getSlabElevationAtPoint(westRamp, 4, 1)).toBeCloseTo(0.05, 6)
    expect(getSlabElevationAtPoint(westRamp, 0, 1)).toBeCloseTo(0.05 + 4 * grade, 6)

    // +Z direction slopes across the 2 m depth
    const southRamp = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.1,
      slope: { direction: 90, pitch },
    })
    expect(getSlabElevationAtPoint(southRamp, 2, 0)).toBeCloseTo(0.1, 6)
    expect(getSlabElevationAtPoint(southRamp, 2, 2)).toBeCloseTo(0.1 + 2 * grade, 6)

    // Diagonal 45° direction
    const diag = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      elevation: 0,
      slope: { direction: 45, pitch: 45 },
    })
    expect(getSlabElevationAtPoint(diag, 0, 0)).toBeCloseTo(0, 6)
    expect(getSlabElevationAtPoint(diag, 2, 2)).toBeCloseTo(2 * Math.SQRT2, 6)
  })

  test('is translation-invariant and keeps the low edge pinned when extending the high edge', () => {
    const base = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.05,
      slope: { direction: 0, pitch: 8 },
    })
    const shifted = SlabNode.parse({
      polygon: RECT_4X2.map(([x, z]) => [x + 12.5, z - 7.25] as [number, number]),
      elevation: 0.05,
      slope: { direction: 0, pitch: 8 },
    })
    expect(getSlabElevationAtPoint(shifted, 12.5 + 3, -7.25 + 1)).toBeCloseTo(
      getSlabElevationAtPoint(base, 3, 1),
      6,
    )

    const extended = SlabNode.parse({
      polygon: [
        [0, 0],
        [6, 0],
        [6, 2],
        [0, 2],
      ],
      elevation: 0.05,
      slope: { direction: 0, pitch: 8 },
    })
    // Low edge stays pinned at 0.05 and x = 2 keeps the exact same height
    expect(getSlabElevationAtPoint(extended, 0, 1)).toBeCloseTo(0.05, 6)
    expect(getSlabElevationAtPoint(extended, 2, 1)).toBeCloseTo(
      getSlabElevationAtPoint(base, 2, 1),
      6,
    )
    expect(getSlabMaxElevation(extended)).toBeGreaterThan(getSlabMaxElevation(base))
  })

  test('ignores slope on recessed slabs, base plates, and auto-derived floor plates', () => {
    const recessed = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: -0.5,
      recessed: true,
      slope: { direction: 0, pitch: 15 },
    })
    const basePlate = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.05,
      plateRole: 'base',
      slope: { direction: 0, pitch: 15 },
    })
    const autoPlate = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.05,
      boundary: 'auto',
      slope: { direction: 0, pitch: 15 },
    })

    for (const slab of [recessed, basePlate, autoPlate]) {
      expect(hasSlabSlope(slab)).toBe(false)
      expect(getSlabSlopePlane(slab).sloped).toBe(false)
      expect(getSlabElevationAtPoint(slab, 4, 1)).toBeCloseTo(slab.elevation, 6)
    }
  })

  test('computes an upward unit normal perpendicular to the sloped surface up to 45°', () => {
    const steep = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0,
      slope: { direction: 0, pitch: 45 },
    })
    const normal = getSlabSurfaceNormal(steep)
    expect(Math.hypot(normal[0], normal[1], normal[2])).toBeCloseTo(1, 6)
    expect(normal[1]).toBeCloseTo(Math.SQRT1_2, 6)
    // Uphill tangent along +X is (1, tan(45°), 0) = (1, 1, 0)
    expect(normal[0] * 1 + normal[1] * 1 + normal[2] * 0).toBeCloseTo(0, 6)
  })

  test('intersects vertical, oblique, and horizontal rays with the sloped plane', () => {
    const ramp = SlabNode.parse({
      polygon: RECT_4X2,
      elevation: 0.1,
      slope: { direction: 0, pitch: 45 }, // y = 0.1 + x
    })

    // Straight downward ray at x = 2.5, z = 1 hits y = 2.6
    const down = intersectRayWithSlabPlane(ramp, [2.5, 5, 1], [0, -1, 0])
    expect(down).not.toBeNull()
    expect(down!.x).toBeCloseTo(2.5, 6)
    expect(down!.y).toBeCloseTo(2.6, 6)
    expect(down!.z).toBeCloseTo(1, 6)

    // Horizontal ray at y = 2.1 heading +X from x = 0 hits x = 2.0, y = 2.1
    const horiz = intersectRayWithSlabPlane(ramp, [0, 2.1, 1], [1, 0, 0])
    expect(horiz).not.toBeNull()
    expect(horiz!.x).toBeCloseTo(2.0, 6)
    expect(horiz!.y).toBeCloseTo(2.1, 6)

    // Ray pointing away returns null
    expect(intersectRayWithSlabPlane(ramp, [0, 2.1, 1], [-1, 0, 0])).toBeNull()
  })

  test('ignores slope on all reconciler-owned plateRole values (base, platform, sunken)', () => {
    for (const plateRole of ['base', 'platform', 'sunken'] as const) {
      const plate = SlabNode.parse({
        polygon: RECT_4X2,
        elevation: 0.2,
        plateRole,
        slope: { direction: 0, pitch: 15 },
      })
      expect(hasSlabSlope(plate)).toBe(false)
      expect(getSlabElevationAtPoint(plate, 4, 1)).toBeCloseTo(0.2, 6)
    }
  })

  test('slabSlopeEqual compares direction and pitch', () => {
    expect(slabSlopeEqual(undefined, undefined)).toBe(true)
    expect(slabSlopeEqual({ direction: 0, pitch: 5 }, { direction: 0, pitch: 5 })).toBe(true)
    expect(slabSlopeEqual({ direction: 0, pitch: 5 }, { direction: 90, pitch: 5 })).toBe(false)
    expect(slabSlopeEqual({ direction: 0, pitch: 5 }, undefined)).toBe(false)
  })
})
