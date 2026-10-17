import { afterEach, expect, test } from 'bun:test'
import { DEFAULT_UNDERGROUND_LOOK, groundHoleOpenNode } from '@pascal-app/viewer'
import {
  groundHoleColorNode,
  groundHoleContains,
  groundHoleDistanceAt,
  groundHoleShadowNode,
  HOLE_ERODE,
  HOLE_MARGIN,
  holeRadiusAt,
  setGroundHoleEdge,
  setGroundHoleFootprints,
  solidGroundMaskNode,
} from './ground-hole'
import { EDGE_LOOKS } from './underground-edge'

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
  setGroundHoleEdge('noise')
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

test('the section cut is a constant offset, the quiet edge a faint fine noise, today’s the eroded one', () => {
  const spread = (edge: 'noise' | 'quiet' | 'section' | 'section-earth') => {
    setGroundHoleEdge(edge)
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (let x = -20; x < 20; x += 0.37)
      for (let z = -20; z < 20; z += 0.41) {
        const radius = holeRadiusAt(x, z)
        low = Math.min(low, radius)
        high = Math.max(high, radius)
      }
    return { low, high }
  }
  const section = spread('section')
  expect(section.low).toBe(0.6)
  expect(section.high).toBe(0.6)
  expect(spread('section-earth')).toEqual(section)
  const quiet = spread('quiet')
  const noise = spread('noise')
  expect(quiet.high - quiet.low).toBeGreaterThan(0.05)
  expect(quiet.high - quiet.low).toBeLessThanOrEqual(2 * EDGE_LOOKS.quiet.erode * 1.5 + 1e-6)
  expect(noise.high - noise.low).toBeGreaterThan(5 * (quiet.high - quiet.low))
  // Today's numbers are the shipped ones.
  expect(EDGE_LOOKS.noise.margin).toBe(HOLE_MARGIN)
  expect(EDGE_LOOKS.noise.erode).toBe(HOLE_ERODE)
})

test('section-earth is the section cut’s outline over quiet’s earth walls', () => {
  const { crumble: earthCrumble, section: earthSection, ...outline } = EDGE_LOOKS['section-earth']
  const { crumble: _c, section: _s, ...cut } = EDGE_LOOKS.section
  expect(outline).toEqual(cut)
  expect(earthSection).toBe(0)
  expect(earthCrumble).toBe(EDGE_LOOKS.quiet.crumble)
  expect(DEFAULT_UNDERGROUND_LOOK.transition).toBe('fade')
})

test('a pick falls through the hole’s guaranteed core of the look in force', () => {
  setGroundHoleFootprints([PLATE])
  groundHoleOpenNode().value = 1
  setGroundHoleEdge('section')
  // 0.6 m margin, no erosion (less a hand's width): 0.5 m out is in the hole, 0.6 m out is not.
  expect(groundHoleContains(-0.5, 2)).toBe(true)
  expect(groundHoleContains(-0.6, 2)).toBe(false)
  // Today's edge keeps a wider sure core (1.6 m less 0.9 m of erosion).
  setGroundHoleEdge('noise')
  expect(groundHoleContains(-0.6, 2)).toBe(true)
})
