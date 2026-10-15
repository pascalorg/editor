import { afterEach, expect, test } from 'bun:test'
import { groundHoleOpenNode } from '@pascal-app/viewer'
import {
  groundHoleColorNode,
  groundHoleContains,
  groundHoleDistanceAt,
  groundHoleShadowNode,
  HOLE_ERODE,
  HOLE_MARGIN,
  setGroundHoleFootprints,
  solidGroundMaskNode,
} from './ground-hole'

// Over a level below grade the ground stays solid and a hole opens over the below-grade footprint,
// its edge a noise threshold. The footprint is baked into a signed-distance texture; the CPU twin
// (for picks and Follow's sight) answers from the same bake with the part of the hole the noise
// cannot take back.

const PLATE: Array<[number, number]> = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]

afterEach(() => {
  groundHoleOpenNode().value = 0
  setGroundHoleFootprints([])
})

test('the footprint is baked as a signed distance: negative inside, growing outside', () => {
  setGroundHoleFootprints([PLATE])
  // 0.25 m of texture quantisation and a bilinear read: within a few centimetres of the truth.
  expect(groundHoleDistanceAt(3, 2)).toBeCloseTo(-2, 1)
  expect(groundHoleDistanceAt(-1, 2)).toBeCloseTo(1, 1)
  expect(groundHoleDistanceAt(3, 6)).toBeCloseTo(2, 1)
  expect(groundHoleDistanceAt(0.5, 2)).toBeLessThan(0)
  // Past the baked margin the field is far: no hole can reach there.
  expect(groundHoleDistanceAt(60, 60)).toBeGreaterThan(HOLE_MARGIN + HOLE_ERODE)
})

test('an L-shaped footprint is its outline, not its box', () => {
  setGroundHoleFootprints([
    [
      [0, 0],
      [8, 0],
      [8, 3],
      [3, 3],
      [3, 8],
      [0, 8],
    ],
  ])
  expect(groundHoleDistanceAt(1, 6)).toBeLessThan(0)
  // The notch of the box (6, 6) is outside the footprint, 3 m from its nearest wall.
  expect(groundHoleDistanceAt(6, 6)).toBeCloseTo(3, 0)
})

test('the CPU twin is the hole’s guaranteed core, and only while the hole is open', () => {
  setGroundHoleFootprints([PLATE])
  expect(groundHoleContains(3, 2)).toBe(false)
  groundHoleOpenNode().value = 1
  expect(groundHoleContains(3, 2)).toBe(true)
  // Just outside the wall, inside the least margin the noise leaves (margin less erosion).
  expect(groundHoleContains(-(HOLE_MARGIN - HOLE_ERODE) / 2, 2)).toBe(true)
  // At the full margin the noise may or may not have taken it: the ground keeps it for picks.
  expect(groundHoleContains(-(HOLE_MARGIN + HOLE_ERODE), 2)).toBe(false)
  expect(groundHoleContains(30, 30)).toBe(false)
  // Half open: the core is half as wide.
  groundHoleOpenNode().value = 0.5
  expect(groundHoleContains(-(HOLE_MARGIN - HOLE_ERODE) * 0.9, 2)).toBe(false)
})

test('without footprints there is no hole', () => {
  groundHoleOpenNode().value = 1
  setGroundHoleFootprints([])
  expect(groundHoleContains(3, 2)).toBe(false)
})

test('the margin leaves the footprint always inside the hole', () => {
  expect(HOLE_MARGIN).toBeGreaterThan(HOLE_ERODE)
})

test('the mask, the rim and the shadow word build as TSL nodes', () => {
  expect(solidGroundMaskNode()).toBeTruthy()
  expect(groundHoleColorNode('#4a5470')).toBeTruthy()
  expect(typeof groundHoleShadowNode()).toBe('function')
})
