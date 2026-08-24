import { describe, expect, test } from 'bun:test'
import { Matrix4 } from 'three'
import {
  calculateRoofRotation,
  getGridAlignedDimensions,
  getSideFromNormal,
  isValidWallSideFace,
  steppedRotation,
  stripTransient,
} from '../item/placement-math'

describe('Floor Stack & Placement Preview Guard Tests', () => {
  test('steppedRotation rounds to nearest 45-degree quantum and increments', () => {
    const fortyFive = Math.PI / 4
    // 0 + 1 step = 45 deg
    expect(steppedRotation(0, 1)).toBeCloseTo(fortyFive, 5)
    // 45 deg - 1 step = 0 deg
    expect(steppedRotation(fortyFive, -1)).toBeCloseTo(0, 5)
  })

  test('getGridAlignedDimensions expands footprint for floor-placed vs along-wall for wall-placed', () => {
    const dims: [number, number, number] = [0.35, 0.8, 0.45]
    // Floor-placed with 0.5 step: X (0.35 -> 0.5), Y (0.8 -> 0.8), Z (0.45 -> 0.5)
    const floorAligned = getGridAlignedDimensions(dims, undefined, 0.5)
    expect(floorAligned[0]).toBe(0.5)
    expect(floorAligned[1]).toBe(0.8)
    expect(floorAligned[2]).toBe(0.5)

    // Wall-placed with 0.5 step: X (0.35 -> 0.5), Y (0.8 -> 1.0), Z (0.45 -> 0.45 exact)
    const wallAligned = getGridAlignedDimensions(dims, 'wall-side', 0.5)
    expect(wallAligned[0]).toBe(0.5)
    expect(wallAligned[1]).toBe(1.0)
    expect(wallAligned[2]).toBe(0.45)
  })

  test('wall side normal validation filters top/bottom edges and identifies front/back faces', () => {
    // Normal along local Z is a valid face
    expect(isValidWallSideFace([0, 0, 1])).toBe(true)
    expect(isValidWallSideFace([0, 0, -1])).toBe(true)
    expect(getSideFromNormal([0, 0, 1])).toBe('front')
    expect(getSideFromNormal([0, 0, -1])).toBe('back')

    // Top face (normal [0, 1, 0]) is not a valid side face
    expect(isValidWallSideFace([0, 1, 0])).toBe(false)
  })

  test('calculateRoofRotation aligns Euler orientation to sloped surface normal', () => {
    const identityMatrix = new Matrix4()
    // Normal tilted 45 degrees along X
    const slopedNormal: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0]
    const [rx, ry, rz] = calculateRoofRotation(slopedNormal, identityMatrix)

    // Rotation should not be zero
    expect(Math.abs(rx) + Math.abs(ry) + Math.abs(rz)).toBeGreaterThan(0)
  })

  test('stripTransient purges isNew and isTransient flags cleanly', () => {
    const raw = { id: 'node_1', isNew: true, isTransient: true, name: 'Rack' }
    const cleaned = stripTransient(raw)
    expect(cleaned).toEqual({ id: 'node_1', name: 'Rack' })
    expect(cleaned.isNew).toBeUndefined()
    expect(cleaned.isTransient).toBeUndefined()
  })
})
