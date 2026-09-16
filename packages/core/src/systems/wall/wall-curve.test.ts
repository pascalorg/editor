import { describe, expect, test } from 'bun:test'
import { WallNode } from '../../schema'
import {
  getWallCurveFrameAtDistance,
  getWallCurveLength,
  getWallCurveSampleCount,
  getWallCurveSampledLength,
  getWallPointAtDistance,
  projectPointToWallCenterline,
  sampleWallCenterline,
} from './wall-curve'

describe('wall centerline geometry kernel', () => {
  test('uses chord distance for straight walls', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [3, 4] })
    expect(getWallCurveLength(wall)).toBe(5)
    expect(getWallCurveSampledLength(wall, 4)).toBe(5)
    expect(getWallPointAtDistance(wall, 2.5)).toEqual({ x: 1.5, y: 2 })
  })

  test('uses circular arc length for curved walls', () => {
    const wall = WallNode.parse({ start: [-2, 0], end: [2, 0], curveOffset: 1 })
    const arc = getWallCurveLength(wall)
    const midpoint = getWallCurveFrameAtDistance(wall, arc / 2)
    expect(arc).toBeGreaterThan(4)
    expect(Math.abs(midpoint.point.y)).toBeCloseTo(1, 6)
    expect(Math.abs(midpoint.tangent.x)).toBeCloseTo(1, 6)
  })

  test('adapts curve samples to curvature while keeping chord error bounded', () => {
    const shallow = WallNode.parse({ start: [0, 0], end: [10, 0], curveOffset: 0.2 })
    const strong = WallNode.parse({ start: [0, 0], end: [10, 0], curveOffset: 4 })
    expect(getWallCurveSampleCount(shallow)).toBeLessThan(getWallCurveSampleCount(strong))

    const tolerance = 0.005
    const count = getWallCurveSampleCount(strong, tolerance)
    const points = sampleWallCenterline(strong, count)
    let maxError = 0
    for (let index = 0; index < count; index += 1) {
      const midpoint = getWallCurveFrameAtDistance(
        strong,
        (getWallCurveLength(strong) * (index + 0.5)) / count,
      ).point
      const chordMidpoint = {
        x: (points[index]!.x + points[index + 1]!.x) / 2,
        y: (points[index]!.y + points[index + 1]!.y) / 2,
      }
      maxError = Math.max(
        maxError,
        Math.hypot(midpoint.x - chordMidpoint.x, midpoint.y - chordMidpoint.y),
      )
    }
    expect(maxError).toBeLessThanOrEqual(tolerance + 1e-6)
  })

  test('projects onto the nearest point while preserving signed normal distance', () => {
    const wall = WallNode.parse({ start: [-2, 0], end: [2, 0], curveOffset: 1 })
    const frame = getWallCurveFrameAtDistance(wall, getWallCurveLength(wall) * 0.35)
    const projected = projectPointToWallCenterline(wall, {
      x: frame.point.x + frame.normal.x * 0.25,
      y: frame.point.y + frame.normal.y * 0.25,
    })
    expect(projected.distanceAlong).toBeCloseTo(getWallCurveLength(wall) * 0.35, 5)
    expect(projected.signedNormalDistance).toBeCloseTo(0.25, 5)
  })
})
