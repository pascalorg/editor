import { describe, expect, it } from 'bun:test'
import { sightTriangle, streetCorners } from '@pascal-app/core'
import {
  boundsInsidePolygon,
  castYardDimensions,
  classifyEdges,
  edgeHeadingDeg,
  formatFeetInches,
  METRES_PER_FOOT,
  mostNorthFacingEdge,
  outwardNormal,
  polygonArea,
  type Pt,
  rayToPolygon,
  resolveFrontEdge,
  setbackEnvelope,
  setbackForRole,
} from './geometry'

/**
 * 30 m (east-west) × 20 m (north-south) lot, origin at the north-west corner,
 * wound clockwise in the plan frame (x east, y south).
 *
 *   edge 0: north side (top, faces north)
 *   edge 1: east side
 *   edge 2: south side
 *   edge 3: west side
 */
const LOT: Pt[] = [
  [0, 0],
  [30, 0],
  [30, 20],
  [0, 20],
]

describe('outwardNormal', () => {
  it('points out of the ring for every edge regardless of winding', () => {
    const near = (i: number, x: number, y: number) => {
      const n = outwardNormal(LOT, i)
      expect(n[0]).toBeCloseTo(x, 9)
      expect(n[1]).toBeCloseTo(y, 9)
    }
    near(0, 0, -1) // north edge faces north (−y)
    near(1, 1, 0) // east
    near(2, 0, 1) // south
    near(3, -1, 0) // west

    // Reversing the winding relabels the edges but normals still point out:
    // reversed edge 0 runs [0,20] → [30,20], the south side.
    const reversed = [...LOT].reverse()
    const n0 = outwardNormal(reversed, 0)
    expect(n0[0]).toBeCloseTo(0, 9)
    expect(n0[1]).toBeCloseTo(1, 9)
  })
})

describe('edge headings + front edge', () => {
  it('reports compass headings clockwise from north', () => {
    expect(edgeHeadingDeg(LOT, 0)).toBeCloseTo(0, 6)
    expect(edgeHeadingDeg(LOT, 1)).toBeCloseTo(90, 6)
    expect(edgeHeadingDeg(LOT, 2)).toBeCloseTo(180, 6)
    expect(edgeHeadingDeg(LOT, 3)).toBeCloseTo(270, 6)
  })

  it('honours northRotation', () => {
    // Rotate true north 90° clockwise: the plan-up edge now faces west.
    expect(edgeHeadingDeg(LOT, 0, Math.PI / 2)).toBeCloseTo(270, 6)
  })

  it('picks the most north-facing edge as the fallback front', () => {
    expect(mostNorthFacingEdge(LOT)).toBe(0)
    expect(resolveFrontEdge(LOT, undefined)).toBe(0)
    expect(resolveFrontEdge(LOT, 2)).toBe(2)
    // Out-of-range indexes fall back rather than throw.
    expect(resolveFrontEdge(LOT, 9)).toBe(0)
  })
})

describe('classifyEdges', () => {
  it('assigns front / rear and splits the remaining edges left and right', () => {
    const roles = classifyEdges(LOT, 0)
    expect(roles[0]).toBe('front')
    expect(roles[2]).toBe('rear')
    expect(new Set([roles[1], roles[3]])).toEqual(new Set(['left', 'right']))
  })

  it('resolves per-role setbacks with left/right overriding side', () => {
    const s = { front: 7.6, side: 1.5, rear: 4.6, right: 3 }
    expect(setbackForRole(s, 'front')).toBe(7.6)
    expect(setbackForRole(s, 'rear')).toBe(4.6)
    expect(setbackForRole(s, 'left')).toBe(1.5)
    expect(setbackForRole(s, 'right')).toBe(3)
  })
})

describe('setbackEnvelope', () => {
  it('a corner lot: the second street side takes the street setback and the sight triangle clips the corner (Steve, 2026-09-08)', () => {
    // a 30 × 20 lot; edge 0 (north, y = 0) is the front, edge 1 (east, x = 30) the other street
    const roles = classifyEdges(LOT, 0, [0, 1])
    expect(roles[1]).toBe('street')
    expect(roles[2]).toBe('rear')
    expect(setbackForRole({ front: 7.5, side: 2, rear: 5 }, 'street')).toBe(7.5)
    expect(setbackForRole({ front: 7.5, side: 2, rear: 5, streetSide: 4 }, 'street')).toBe(4)
    const plain = setbackEnvelope(LOT, { front: 7.5, side: 2, rear: 5, streetSide: 4 }, 0, { streetEdges: [0, 1] })
    const xs = plain.map((p) => p[0])
    expect(Math.max(...xs)).toBeCloseTo(26, 6) // the east street side in 4, not the 2 ft side yard
    // the 25 ft (7.62 m) sight triangle at the NE corner: its hypotenuse from (22.38, 0) to (30, 7.62) keeps the envelope out
    const clipped = setbackEnvelope(LOT, { front: 7.5, side: 2, rear: 5, streetSide: 4 }, 0, { streetEdges: [0, 1], sightTriangleM: 7.62 })
    expect(clipped.length).toBeGreaterThanOrEqual(4)
    for (const v of clipped) {
      // outside the triangle: x + y ≥ 30 − 7.62 ... the hypotenuse is x − y = 22.38 ... points with x − y > 22.38 are inside it
      expect(v[0] - v[1]).toBeLessThanOrEqual(22.38 + 0.05)
    }
    const tri = sightTriangle(LOT, 0, 1, 7.62)
    expect(tri).not.toBeNull()
    expect(tri!.corner[0]).toBeCloseTo(30, 6)
    expect(tri!.corner[1]).toBeCloseTo(0, 6)
    expect(streetCorners(LOT, [0, 1])).toEqual([[0, 1]])
  })

  it('a cul-de-sac corner (a run of short arc edges) is offset as one chord — no vertex runs away (Steve, 2026-09-08)', () => {
    const cape: [number, number][] = [
      [-2, 0], [-2, 30.1], [-40, 32.7], [-40, -5.6], [-10.1, -7.6], [-8.9, -7.6], [-7.7, -7.3], [-6.5, -6.9],
      [-5.4, -6.3], [-4.4, -5.5], [-3.6, -4.6], [-2.9, -3.6], [-2.4, -2.4], [-2.1, -1.2],
    ]
    const env = setbackEnvelope(cape, { front: 6.096, side: 1.524, rear: 4.572 }, 0)
    expect(env.length).toBeGreaterThanOrEqual(6)
    // every envelope vertex lies inside the lot, at least its setback from every lot line
    const segDist = (p: readonly number[], a: readonly number[], b: readonly number[]) => {
      const abx = b[0]! - a[0]!
      const aby = b[1]! - a[1]!
      const t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * abx + (p[1]! - a[1]!) * aby) / (abx * abx + aby * aby)))
      return Math.hypot(p[0]! - (a[0]! + abx * t), p[1]! - (a[1]! + aby * t))
    }
    // the curb return (edges 4–13) is street frontage: it takes the FRONT setback, never a side yard
    const frontLike = new Set([0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    for (const v of env) {
      for (let i = 0; i < cape.length; i++) {
        const want = frontLike.has(i) ? 6.096 : 1.524
        expect(segDist(v, cape[i]!, cape[(i + 1) % cape.length]!)).toBeGreaterThan(want - 0.06)
      }
    }
    // the front line (x = −2, the east side) offset 6.1 m in: two vertices on x ≈ −8.1
    const onFront = env.filter((v) => Math.abs(v[0] - (-2 - 6.096)) < 0.05)
    expect(onFront.length).toBeGreaterThanOrEqual(2)
    // the return's offset is a curve of its own (a 6.1 m buffer round the return's points), not a chord: the
    // envelope turns through more than one vertex between the front offset and the south offset
    const turning = env.filter((v) => v[0] < -8.2 + 0.05 && v[1] < 2 && v[1] > -6.2)
    expect(turning.length).toBeGreaterThanOrEqual(2)
  })

  it('offsets each edge inward by its own setback', () => {
    const env = setbackEnvelope(LOT, { front: 7.5, side: 2, rear: 5 }, 0)
    expect(env).toHaveLength(4)
    const xs = env.map((p) => p[0]).sort((a, b) => a - b)
    const ys = env.map((p) => p[1]).sort((a, b) => a - b)
    // North (front) edge in 7.5, south (rear) in 5, both sides in 2.
    expect(xs[0]).toBeCloseTo(2, 9)
    expect(xs[3]).toBeCloseTo(28, 9)
    expect(ys[0]).toBeCloseTo(7.5, 9)
    expect(ys[3]).toBeCloseTo(15, 9)
    expect(polygonArea(env)).toBeCloseTo(26 * 7.5, 6)
  })

  it('applies left/right overrides to the correct sides', () => {
    const env = setbackEnvelope(LOT, { front: 0, side: 0, rear: 0, left: 4, right: 1 }, 0)
    const xs = env.map((p) => p[0]).sort((a, b) => a - b)
    // Front edge runs [0,0] → [30,0]; "left" is behind that direction (west).
    expect(xs[0]).toBeCloseTo(4, 9)
    expect(xs[3]).toBeCloseTo(29, 9)
  })

  it('rejects setbacks that consume the lot instead of drawing a bow tie', () => {
    expect(setbackEnvelope(LOT, { front: 12, side: 2, rear: 12 }, 0)).toEqual([])
    expect(setbackEnvelope(LOT, { front: 0, side: 0, rear: 0 }, 0)).toEqual([])
    expect(setbackEnvelope([[0, 0]], { front: 1, side: 1, rear: 1 }, 0)).toEqual([])
  })
})

describe('rayToPolygon + castYardDimensions', () => {
  it('finds the nearest boundary crossing along a ray', () => {
    const hit = rayToPolygon(LOT, [15, 10], 0, -1)
    expect(hit?.distance).toBeCloseTo(10, 9)
    expect(hit?.point[1]).toBeCloseTo(0, 9)
    // A ray from outside pointing away never hits.
    expect(rayToPolygon(LOT, [15, -5], 0, -1)).toBeNull()
  })

  it('casts four yard dimensions from the footprint bbox edge midpoints', () => {
    const yards = castYardDimensions(LOT, { minX: 10, minY: 6, maxX: 20, maxY: 14 })
    expect(yards.map((y) => y.side).sort()).toEqual(['east', 'north', 'south', 'west'])
    const by = Object.fromEntries(yards.map((y) => [y.side, y]))
    expect(by.north?.distance).toBeCloseTo(6, 9)
    expect(by.south?.distance).toBeCloseTo(6, 9)
    expect(by.west?.distance).toBeCloseTo(10, 9)
    expect(by.east?.distance).toBeCloseTo(10, 9)
    // Dimensions start at the bbox midpoints, not the corners.
    expect(by.north?.from).toEqual([15, 6])
    expect(by.west?.from).toEqual([10, 10])
  })

  it('omits a side whose ray misses the lot rather than faking a number', () => {
    // Footprint entirely north of (above) the lot: nothing casts north.
    const yards = castYardDimensions(LOT, { minX: 10, minY: -30, maxX: 20, maxY: -25 })
    expect(yards.map((y) => y.side)).not.toContain('north')
  })
})

describe('boundsInsidePolygon', () => {
  it('is true only when every bbox corner is inside the lot', () => {
    expect(boundsInsidePolygon(LOT, { minX: 5, minY: 5, maxX: 25, maxY: 15 })).toBe(true)
    expect(boundsInsidePolygon(LOT, { minX: -5, minY: 5, maxX: 25, maxY: 15 })).toBe(false)
    expect(boundsInsidePolygon(LOT, { minX: 100, minY: 100, maxX: 110, maxY: 110 })).toBe(false)
  })
})

describe('formatFeetInches', () => {
  it('renders metres as feet-and-inches', () => {
    expect(formatFeetInches(7.62)).toBe(`25'-0"`)
    expect(formatFeetInches(METRES_PER_FOOT * 24.5)).toBe(`24'-6"`)
    expect(formatFeetInches(0)).toBe(`0'-0"`)
  })
})
