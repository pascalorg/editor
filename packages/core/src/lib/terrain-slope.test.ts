import { describe, expect, test } from 'bun:test'
import { isDatumField } from './terrain-codec'
import { createTerrainField, heightAt } from './terrain-field'
import {
  buildSlopedTerrainField,
  clampTerrainSlopePitch,
  deriveTerrainSlopeFromPoints,
  evaluateTerrainSlopePlane,
  MAX_TERRAIN_SLOPE_PITCH,
  normalizeTerrainSlopeDirection,
  resolveLotSlopePlane,
  terrainSlopeElevationRange,
  terrainSlopeGradePercent,
} from './terrain-slope'

const LOT: Array<[number, number]> = [
  [-10, -20],
  [10, -20],
  [10, 20],
  [-10, 20],
]

describe('terrain-slope math', () => {
  test('clamps pitch and normalizes direction cleanly', () => {
    expect(clampTerrainSlopePitch(-5)).toBe(0)
    expect(clampTerrainSlopePitch(Number.NaN)).toBe(0)
    expect(clampTerrainSlopePitch(12.5)).toBe(12.5)
    expect(clampTerrainSlopePitch(90)).toBe(MAX_TERRAIN_SLOPE_PITCH)

    expect(normalizeTerrainSlopeDirection(0)).toBe(0)
    expect(normalizeTerrainSlopeDirection(-0)).toBe(0)
    expect(normalizeTerrainSlopeDirection(360)).toBe(0)
    expect(normalizeTerrainSlopeDirection(-90)).toBe(270)
    expect(normalizeTerrainSlopeDirection(450)).toBe(90)
    expect(normalizeTerrainSlopeDirection(Number.POSITIVE_INFINITY)).toBe(0)
  })

  test('computes grade percentage accurately', () => {
    expect(terrainSlopeGradePercent(0)).toBe(0)
    expect(terrainSlopeGradePercent(45)).toBeCloseTo(100, 6)
    expect(terrainSlopeGradePercent(Math.atan(0.08) * (180 / Math.PI))).toBeCloseTo(8, 6)
  })

  test('center anchor pins baseElevation at lot center', () => {
    const plane = resolveLotSlopePlane(LOT, {
      pitch: 45,
      direction: 0,
      baseElevation: 1.5,
      anchor: 'center',
    })
    expect(evaluateTerrainSlopePlane(plane, 0, 0)).toBeCloseTo(1.5, 6)
    expect(evaluateTerrainSlopePlane(plane, 10, 0)).toBeCloseTo(11.5, 6)
    expect(evaluateTerrainSlopePlane(plane, -10, 0)).toBeCloseTo(-8.5, 6)
  })

  test('low-edge anchor pins baseElevation at minimum projection vertex', () => {
    const plane = resolveLotSlopePlane(LOT, {
      pitch: 45,
      direction: 90,
      baseElevation: 0.5,
      anchor: 'low-edge',
    })
    expect(evaluateTerrainSlopePlane(plane, 0, -20)).toBeCloseTo(0.5, 6)
    expect(evaluateTerrainSlopePlane(plane, 0, 0)).toBeCloseTo(20.5, 6)
    expect(evaluateTerrainSlopePlane(plane, 0, 20)).toBeCloseTo(40.5, 6)
  })

  test('reports lot min/max/rise range', () => {
    const range = terrainSlopeElevationRange(LOT, {
      pitch: Math.atan(0.1) * (180 / Math.PI),
      direction: 90,
      baseElevation: 0,
      anchor: 'center',
    })
    expect(range.gradePercent).toBeCloseTo(10, 5)
    expect(range.min).toBeCloseTo(-2, 5)
    expect(range.max).toBeCloseTo(2, 5)
    expect(range.rise).toBeCloseTo(4, 5)
  })
})

describe('deriveTerrainSlopeFromPoints', () => {
  test('derives exact uphill plane from two points', () => {
    const derived = deriveTerrainSlopeFromPoints([0, 0, 1], [10, 0, 3])
    expect(derived).not.toBeNull()
    expect(derived!.direction).toBeCloseTo(0, 5)
    expect(derived!.pitch).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 5)
    expect(derived!.clamped).toBe(false)

    const plane = {
      anchorX: derived!.anchor[0],
      anchorZ: derived!.anchor[1],
      anchorY: derived!.anchor[2],
      direction: derived!.direction,
      pitch: derived!.pitch,
    }
    expect(evaluateTerrainSlopePlane(plane, 0, 0)).toBeCloseTo(1, 5)
    expect(evaluateTerrainSlopePlane(plane, 5, 0)).toBeCloseTo(2, 5)
    expect(evaluateTerrainSlopePlane(plane, 10, 0)).toBeCloseTo(3, 5)
  })

  test('flips uphill direction when end point is lower than start point', () => {
    const derived = deriveTerrainSlopeFromPoints([0, 0, 4], [0, 10, 2])
    expect(derived).not.toBeNull()
    expect(derived!.direction).toBeCloseTo(270, 5)
    const plane = {
      anchorX: derived!.anchor[0],
      anchorZ: derived!.anchor[1],
      anchorY: derived!.anchor[2],
      direction: derived!.direction,
      pitch: derived!.pitch,
    }
    expect(evaluateTerrainSlopePlane(plane, 0, 0)).toBeCloseTo(4, 5)
    expect(evaluateTerrainSlopePlane(plane, 0, 10)).toBeCloseTo(2, 5)
  })

  test('handles flat, steep-clamped, and coincident points', () => {
    const flat = deriveTerrainSlopeFromPoints([0, 0, 2], [5, 5, 2])
    expect(flat?.pitch).toBe(0)
    expect(flat?.verticalDelta).toBe(0)

    const steep = deriveTerrainSlopeFromPoints([0, 0, 0], [1, 0, 10])
    expect(steep?.pitch).toBe(MAX_TERRAIN_SLOPE_PITCH)
    expect(steep?.clamped).toBe(true)

    expect(deriveTerrainSlopeFromPoints([2, 3, 1], [2, 3, 5])).toBeNull()
  })
})

describe('buildSlopedTerrainField', () => {
  test('grades the full heightfield accurately and returns datum when flat at 0', () => {
    const base = createTerrainField({ origin: [-12, -22], cols: 65, rows: 129, spacing: 0.5 })
    const sloped = buildSlopedTerrainField(base, LOT, {
      pitch: Math.atan(0.05) * (180 / Math.PI),
      direction: 90,
      baseElevation: 0,
      anchor: 'center',
    })
    expect(isDatumField(sloped)).toBe(false)
    expect(heightAt(sloped, 0, 0)).toBeCloseTo(0, 2)
    expect(heightAt(sloped, 0, 20)).toBeCloseTo(1, 2)
    expect(heightAt(sloped, 0, -20)).toBeCloseTo(-1, 2)

    const flatZero = buildSlopedTerrainField(sloped, LOT, {
      pitch: 0,
      direction: 90,
      baseElevation: 0,
    })
    expect(isDatumField(flatZero)).toBe(true)
  })
})
