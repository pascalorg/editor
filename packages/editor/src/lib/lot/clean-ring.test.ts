import { describe, expect, test } from 'bun:test'
import type { Pt } from '../floorplan/site-plan/geometry'
import { classifyEdges, setbackEnvelope } from '../floorplan/site-plan/geometry'
import {
  cleanLotRing,
  describeRingCleanup,
  dropDuplicateVertices,
  mergeCollinearVertices,
  squareCornerArcs,
} from './clean-ring'

/**
 * 2600 Castro Way, Sacramento — the registry ring as `/api/parcel/resolve`
 * returned it on 2026-09-06 (metres, x east, y south): a nine-segment
 * curb-return arc (edges 0–8), the rest of the Castro Way frontage (edge
 * 9), the two long sides and the rear.
 */
const LAND_PARK: Pt[] = [
  [0.36, 6.96],
  [0.55, 5.77],
  [0.89, 4.64],
  [1.38, 3.59],
  [2.01, 2.67],
  [2.75, 1.91],
  [3.58, 1.32],
  [4.49, 0.92],
  [5.42, 0.73],
  [6.38, 0.75],
  [15.44, 0.68],
  [15.7, 34.76],
  [0.88, 34.94],
]

const RECT: Pt[] = [
  [-10, -15],
  [10, -15],
  [10, 15],
  [-10, 15],
]

describe('dropDuplicateVertices / mergeCollinearVertices', () => {
  test('the closing repeat and near-duplicates go, straight-line points merge', () => {
    const ring: Pt[] = [
      [0, 0],
      [5, 0],
      [5.01, 0],
      [10, 0],
      [10, 6],
      [0, 6],
      [0, 0],
    ]
    const d = dropDuplicateVertices(ring)
    expect(d).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ])
    expect(mergeCollinearVertices(d)).toEqual([
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ])
  })

  test('a clean rectangle is untouched', () => {
    expect(mergeCollinearVertices(dropDuplicateVertices(RECT))).toEqual(RECT)
  })
})

describe('squareCornerArcs', () => {
  test('a curb-return arc becomes the corner the long edges make', () => {
    const r = squareCornerArcs(LAND_PARK)
    expect(r.arcs).toBe(1)
    expect(r.arcVertices).toBe(9)
    expect(r.points).toHaveLength(4)
    // the corner: the Castro Way line (edge 9) extended meets the west side
    // (edge 12: (0.88, 34.94) → (0.36, 6.96)) extended — x = 0.88 − 0.52 · (34.94 − 0.80) / 27.98
    const corner = r.points.find((p) => p[0] < 1 && p[1] < 2)!
    expect(corner).toBeDefined()
    expect(corner[0]).toBeCloseTo(0.245, 2)
    expect(corner[1]).toBeCloseTo(0.797, 2)
  })

  test('a small chamfer is squared, a long one is kept', () => {
    const chamfer: Pt[] = [
      [0, 0],
      [8, 0],
      [10, 2], // 2.8 m cut across the corner
      [10, 10],
      [0, 10],
    ]
    const r = squareCornerArcs(chamfer)
    expect(r.arcs).toBe(1)
    expect(r.arcVertices).toBe(1)
    expect(r.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    const big: Pt[] = [
      [0, 0],
      [20, 0],
      [40, 20], // 28 m — a real diagonal side, not a corner rounding
      [40, 60],
      [0, 60],
    ]
    expect(squareCornerArcs(big).arcs).toBe(0)
  })

  test('a split straight run is not a corner; one that starts at a corner squares to the same ring', () => {
    // three 2 m pieces in the MIDDLE of the frontage: the long edges on both
    // sides run the same way, nothing to square (the collinear pass merges them)
    const mid: Pt[] = [
      [0, 0],
      [8, 0],
      [10, 0],
      [12, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ]
    expect(squareCornerArcs(mid).arcs).toBe(0)
    // the same pieces starting AT the corner: the long edges meet at 90° and
    // their intersection is the corner itself — the ring comes out identical
    const atCorner: Pt[] = [
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ]
    expect(squareCornerArcs(atCorner).points).toEqual([
      [0, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ])
  })
})

describe('cleanLotRing on the real Land Park ring', () => {
  test('13 vertices → 4, and the envelope and roles come out right', () => {
    const c = cleanLotRing(LAND_PARK)
    expect(c.points).toHaveLength(4)
    expect(c.removed.arcs).toBe(1)
    expect(c.removed.arcVertices).toBe(9)
    expect(c.removed.collinear).toBe(0)
    expect(describeRingCleanup(LAND_PARK.length, c)).toBe(
      'Lot ring simplified for planning: 13 → 4 vertices (1 rounded corner squared (9 arc vertices)); setbacks and the street edge use the simplified ring, the recorded lot area stands.',
    )
    // Castro Way frontage is the edge from the squared corner to (15.44, 0.68)
    const front = c.points.findIndex((p, i) => {
      const q = c.points[(i + 1) % c.points.length]!
      return p[1] < 2 && q[1] < 2
    })
    expect(front).toBeGreaterThanOrEqual(0)
    const roles = classifyEdges(c.points, front)
    expect(roles.filter((r) => r === 'front')).toHaveLength(1)
    expect(roles.filter((r) => r === 'rear')).toHaveLength(1)
    const env = setbackEnvelope(c.points, { front: 6.096, side: 1.524, rear: 4.572 }, front)
    expect(env).toHaveLength(4)
    // frontage of the envelope ≈ lot width − 2 × 5 ft ≈ 14.7 − 3.05 m
    const p = env[front]!
    const q = env[(front + 1) % 4]!
    expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeCloseTo(14.72 - 3.048, 0)
  })

  test('the raw ring had no usable envelope — the cleanup is what makes placement possible', () => {
    // the sliver edge 8 is what the road detector picked on the raw ring
    expect(setbackEnvelope(LAND_PARK, { front: 6.096, side: 1.524, rear: 4.572 }, 8)).toEqual([])
  })

  test('nothing to clean, nothing said', () => {
    const c = cleanLotRing(RECT)
    expect(c.points).toEqual(RECT)
    expect(describeRingCleanup(4, c)).toBe('')
  })
})
