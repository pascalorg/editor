import { describe, expect, test } from 'bun:test'
import { getDutchRoofMetrics, getRidgeVentLinesForSegment, RoofSegmentNode } from '@pascal-app/core'
import type * as THREE from 'three'
import { getRoofTopSurfaceY } from '../../shared/roof-surface'
import { buildRidgeVentGeometry } from '../geometry'
import { RidgeVentNode } from '../schema'

function minYAtLocalPoint(geo: THREE.BufferGeometry, targetX: number, targetZ: number): number {
  const pos = geo.getAttribute('position').array as Float32Array
  let minY = Infinity
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i]! - targetX) <= 1e-5 && Math.abs(pos[i + 2]! - targetZ) <= 1e-5) {
      minY = Math.min(minY, pos[i + 1]!)
    }
  }
  return minY
}

function xBounds(geo: THREE.BufferGeometry): { minX: number; maxX: number } {
  const pos = geo.getAttribute('position').array as Float32Array
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]!)
    maxX = Math.max(maxX, pos[i]!)
  }
  return { minX, maxX }
}

function maxAbsZNearX(geo: THREE.BufferGeometry, targetX: number, tolerance = 0.03): number {
  const pos = geo.getAttribute('position').array as Float32Array
  let maxAbsZ = 0
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i]! - targetX) <= tolerance) {
      maxAbsZ = Math.max(maxAbsZ, Math.abs(pos[i + 2]!))
    }
  }
  return maxAbsZ
}

function expectFinitePositions(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position').array as Float32Array
  for (let i = 0; i < pos.length; i++) {
    expect(Number.isFinite(pos[i])).toBe(true)
  }
}

function rotatedSurfaceYAt(
  segment: RoofSegmentNode,
  centerX: number,
  centerZ: number,
  rotation: number,
  localX: number,
  localZ: number,
): number {
  return getRoofTopSurfaceY(
    centerX + localX * Math.cos(rotation) + localZ * Math.sin(rotation),
    centerZ - localX * Math.sin(rotation) + localZ * Math.cos(rotation),
    segment,
  )
}

describe('buildRidgeVentGeometry', () => {
  test('returns geometry with matching position / normal / uv counts', () => {
    const geo = buildRidgeVentGeometry(RidgeVentNode.parse({}))
    const p = geo.getAttribute('position').count
    expect(p).toBeGreaterThan(0)
    expect(geo.getAttribute('normal').count).toBe(p)
    expect(geo.getAttribute('uv').count).toBe(p)
  })

  test('each style produces a different vertex count (no accidental fallthrough)', () => {
    const standard = buildRidgeVentGeometry(
      RidgeVentNode.parse({ style: 'standard' }),
    ).getAttribute('position').count
    const shingled = buildRidgeVentGeometry(
      RidgeVentNode.parse({ style: 'shingled' }),
    ).getAttribute('position').count
    const metal = buildRidgeVentGeometry(RidgeVentNode.parse({ style: 'metal' })).getAttribute(
      'position',
    ).count
    expect(new Set([standard, shingled, metal]).size).toBe(3)
  })

  test('endCaps adds vertices on every style', () => {
    for (const style of ['standard', 'shingled', 'metal'] as const) {
      const without = buildRidgeVentGeometry(
        RidgeVentNode.parse({ style, endCaps: false }),
      ).getAttribute('position').count
      const withCaps = buildRidgeVentGeometry(
        RidgeVentNode.parse({ style, endCaps: true }),
      ).getAttribute('position').count
      expect(withCaps).toBeGreaterThan(without)
    }
  })

  test('length scales the X bounds proportionally', () => {
    const geo = buildRidgeVentGeometry(RidgeVentNode.parse({ length: 4, endCaps: false }))
    const { minX, maxX } = xBounds(geo)
    expect(maxX).toBeCloseTo(2)
    expect(minX).toBeCloseTo(-2)
  })

  test('legacy partial ridge vents never produce NaN positions', () => {
    const geo = buildRidgeVentGeometry({
      id: 'rvent_legacy',
      type: 'ridge-vent',
    } as unknown as Parameters<typeof buildRidgeVentGeometry>[0])

    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
    expectFinitePositions(geo)
  })

  test('clips rendered length to host segment trim without mutating the stored length', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
      trim: { left: 2, right: 1 },
    })
    const vent = RidgeVentNode.parse({
      length: 8,
      position: [0, 0, 0],
      rotation: 0,
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const { minX, maxX } = xBounds(geo)

    expect(vent.length).toBe(8)
    expect(minX).toBeCloseTo(-2)
    expect(maxX).toBeCloseTo(3)
  })

  test('clips rendered ridge vents against diagonal trim planes', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
      trim: { frontLeftX: 2, frontLeftZ: 4 },
    })
    const vent = RidgeVentNode.parse({
      length: 8,
      width: 0.3,
      position: [0, 0, 0],
      rotation: 0,
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const { minX, maxX } = xBounds(geo)

    expect(vent.length).toBe(8)
    expect(vent.position[0]).toBe(0)
    expect(minX).toBeCloseTo(-3.575, 3)
    expect(maxX).toBeCloseTo(4)
  })

  test('seats the underside onto rendered roof top faces when a segment is provided', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
    })
    const vent = RidgeVentNode.parse({
      width: 0.4,
      height: 0.12,
      style: 'shingled',
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const halfLength = vent.length / 2
    const halfWidth = vent.width / 2
    const ridgeY = getRoofTopSurfaceY(0, 0, segment)

    expect(minYAtLocalPoint(geo, -halfLength, -halfWidth)).toBeCloseTo(
      getRoofTopSurfaceY(-halfLength, -halfWidth, segment) - ridgeY,
    )
    expect(minYAtLocalPoint(geo, -halfLength, halfWidth)).toBeCloseTo(
      getRoofTopSurfaceY(-halfLength, halfWidth, segment) - ridgeY,
    )
  })

  test('seats the underside using the vent rotation for diagonal hip caps', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'hip',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
    })
    const rotation = Math.PI / 4
    const centerX = -2.5
    const centerZ = 1.5
    const vent = RidgeVentNode.parse({
      position: [centerX, 0, centerZ],
      rotation,
      width: 0.4,
      height: 0.12,
      style: 'shingled',
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const halfLength = vent.length / 2
    const startHalfWidth = maxAbsZNearX(geo, -halfLength, 1e-5)
    const ridgeY = rotatedSurfaceYAt(segment, centerX, centerZ, rotation, 0, 0)

    expect(startHalfWidth).toBeGreaterThan(0)
    expect(minYAtLocalPoint(geo, -halfLength, -startHalfWidth)).toBeCloseTo(
      rotatedSurfaceYAt(segment, centerX, centerZ, rotation, -halfLength, -startHalfWidth) - ridgeY,
    )
    expect(minYAtLocalPoint(geo, -halfLength, startHalfWidth)).toBeCloseTo(
      rotatedSurfaceYAt(segment, centerX, centerZ, rotation, -halfLength, startHalfWidth) - ridgeY,
    )
  })

  test('seats diagonal hip cap ends at different roof heights along the slope', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'hip',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
    })
    const rotation = Math.PI / 4
    const centerX = -2.5
    const centerZ = 1.5
    const vent = RidgeVentNode.parse({
      position: [centerX, 0, centerZ],
      rotation,
      length: Math.SQRT2,
      width: 0.4,
      height: 0.12,
      style: 'shingled',
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const halfLength = vent.length / 2
    const startHalfWidth = maxAbsZNearX(geo, -halfLength, 1e-5)
    const endHalfWidth = maxAbsZNearX(geo, halfLength, 1e-5)
    const ridgeY = rotatedSurfaceYAt(segment, centerX, centerZ, rotation, 0, 0)
    const leftEndY =
      rotatedSurfaceYAt(segment, centerX, centerZ, rotation, -halfLength, -startHalfWidth) - ridgeY
    const rightEndY =
      rotatedSurfaceYAt(segment, centerX, centerZ, rotation, halfLength, -endHalfWidth) - ridgeY

    expect(startHalfWidth).toBeGreaterThan(0)
    expect(endHalfWidth).toBeGreaterThan(0)
    expect(leftEndY).not.toBeCloseTo(rightEndY)
    expect(minYAtLocalPoint(geo, -halfLength, -startHalfWidth)).toBeCloseTo(leftEndY)
    expect(minYAtLocalPoint(geo, halfLength, -endHalfWidth)).toBeCloseTo(rightEndY)
  })

  test('seats the dutch top ridge with the same sloped cap profile as other ridge vents', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
    })
    const vent = RidgeVentNode.parse({
      name: 'Ridge Vent',
      position: [0, 0, 0],
      rotation: 0,
      length: 5,
      width: 0.3,
      height: 0.1,
      style: 'shingled',
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const halfLength = vent.length / 2
    const halfWidth = vent.width / 2
    const ridgeY = getRoofTopSurfaceY(0, 0, segment)
    const rawRoofDrop = getRoofTopSurfaceY(-halfLength, -halfWidth, segment) - ridgeY

    expect(rawRoofDrop).toBeLessThan(-0.05)
    expect(minYAtLocalPoint(geo, -halfLength, -halfWidth)).toBeCloseTo(rawRoofDrop)
  })

  test('keeps an extended Dutch top ridge level through the rake span instead of drooping onto the hip', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
    })
    const metrics = getDutchRoofMetrics(segment)
    const rakeReach = Math.min(
      segment.dutchGabletRake,
      Math.max(0, segment.width / 2 - metrics.waistHalfX) * 0.98,
    )
    const vent = RidgeVentNode.parse({
      name: 'Ridge Vent',
      position: [0, 0, 0],
      rotation: 0,
      length: (metrics.waistHalfX + rakeReach) * 2,
      width: 0.3,
      height: 0.1,
      style: 'shingled',
      endCaps: false,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const halfLength = vent.length / 2
    const halfWidth = vent.width / 2
    const ridgeY = getRoofTopSurfaceY(0, 0, segment)
    const rawRoofDrop = getRoofTopSurfaceY(-halfLength, -halfWidth, segment) - ridgeY
    const supportedDrop = getRoofTopSurfaceY(-metrics.waistHalfX, -halfWidth, segment) - ridgeY

    expect(rawRoofDrop).toBeLessThan(supportedDrop - 0.05)
    expect(minYAtLocalPoint(geo, -halfLength, -halfWidth)).toBeCloseTo(supportedDrop)
    expect(minYAtLocalPoint(geo, halfLength, -halfWidth)).toBeCloseTo(supportedDrop)
  })

  test('tapers Dutch hip ridge vent ends to a small capped nose without shortening the support-line length', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      wallHeight: 0.5,
      pitch: 45,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })
    const hipLine = getRidgeVentLinesForSegment(segment).find(
      (line) => line.name === 'Hip Ridge Vent' && line.start[0] < 0 && line.start[1] < 0,
    )
    expect(hipLine).toBeDefined()
    const line = hipLine!
    const rotation = Math.atan2(-(line.end[1] - line.start[1]), line.end[0] - line.start[0])
    const vent = RidgeVentNode.parse({
      name: 'Hip Ridge Vent',
      position: [(line.start[0] + line.end[0]) / 2, 0, (line.start[1] + line.end[1]) / 2],
      rotation,
      length: Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1]),
      width: 0.3,
      height: 0.1,
      style: 'shingled',
      endCaps: true,
    })

    const geo = buildRidgeVentGeometry(vent, segment)
    const bounds = xBounds(geo)
    const fullHalfLength = vent.length / 2
    const startWidth = maxAbsZNearX(geo, bounds.minX)
    const endWidth = maxAbsZNearX(geo, bounds.maxX)
    const bodyWidth = maxAbsZNearX(geo, 0, 0.08)

    expect(bounds.minX).toBeLessThanOrEqual(-fullHalfLength + 0.02)
    expect(bounds.maxX).toBeGreaterThan(fullHalfLength - 0.15)
    expect(startWidth).toBeGreaterThan(0.03)
    expect(startWidth).toBeLessThan(0.09)
    expect(endWidth).toBeGreaterThan(0.1)
    expect(bodyWidth).toBeGreaterThan(startWidth + 0.015)
  })
})
