import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { unionPolygons } from '@pascal-app/viewer'
import { getRoofSegmentPlanLinework } from '../roof-segment/floorplan'

type Pt = [number, number]
type Seg = [Pt, Pt]

function signedArea(ring: readonly Pt[]): number {
  let a = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Pt
    const q = ring[(i + 1) % n] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** Distance `t >= 0` from `V` along unit dir `(dx,dz)` to where the ray first
 *  meets segment `A→B`, or null. (Used to terminate valleys at ridges.) */
function rayHitT(
  vx: number,
  vz: number,
  dx: number,
  dz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  const ex = bx - ax
  const ez = bz - az
  const denom = dx * ez - dz * ex
  if (Math.abs(denom) < 1e-9) return null
  const wx = ax - vx
  const wz = az - vz
  const t = (wx * ez - wz * ex) / denom
  const s = (wx * dz - wz * dx) / denom
  if (t < 0) return null
  if (s < -1e-6 || s > 1 + 1e-6) return null
  return t
}

function pointInPolygon(px: number, pz: number, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i] as Pt
    const pj = poly[j] as Pt
    if (
      pi[1] > pz !== pj[1] > pz &&
      px < ((pj[0] - pi[0]) * (pz - pi[1])) / (pj[1] - pi[1]) + pi[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

/** Parametric `t` in (0,1) along `p1→p2` where it crosses segment `a→b`, else null. */
function segCrossT(p1: Pt, p2: Pt, a: Pt, b: Pt): number | null {
  const rx = p2[0] - p1[0]
  const rz = p2[1] - p1[1]
  const ex = b[0] - a[0]
  const ez = b[1] - a[1]
  const denom = rx * ez - rz * ex
  if (Math.abs(denom) < 1e-12) return null
  const wx = a[0] - p1[0]
  const wz = a[1] - p1[1]
  const t = (wx * ez - wz * ex) / denom
  const s = (wx * rz - wz * rx) / denom
  if (t <= 1e-4 || t >= 1 - 1e-9) return null
  if (s < -1e-6 || s > 1 + 1e-6) return null
  return t
}

type SegPlan = {
  footprint: Pt[]
  ridges: Seg[]
  hips: Seg[]
  breaks: Seg[]
  slope: { tail: Pt; head: Pt } | null
}

/** A segment's footprint + ridge/hip/break/slope linework, in world plan coords. */
function buildSegPlan(roof: RoofNode, seg: RoofSegmentNode): SegPlan {
  const cosRoof = Math.cos(-roof.rotation)
  const sinRoof = Math.sin(-roof.rotation)
  const segCx = roof.position[0] + seg.position[0] * cosRoof - seg.position[2] * sinRoof
  const segCz = roof.position[2] + seg.position[0] * sinRoof + seg.position[2] * cosRoof
  const rot = -(roof.rotation + seg.rotation)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const tp = (lx: number, lz: number): Pt => [
    segCx + lx * cos - lz * sin,
    segCz + lx * sin + lz * cos,
  ]
  const hw = Math.max(seg.width, 0.01) / 2
  const hd = Math.max(seg.depth, 0.01) / 2
  const lw = getRoofSegmentPlanLinework(seg)
  const mapSeg = (s: readonly [readonly [number, number], readonly [number, number]]): Seg => [
    tp(s[0][0], s[0][1]),
    tp(s[1][0], s[1][1]),
  ]
  return {
    footprint: [tp(-hw, -hd), tp(hw, -hd), tp(hw, hd), tp(-hw, hd)],
    ridges: lw.ridges.map(mapSeg),
    hips: lw.hips.map(mapSeg),
    breaks: lw.breaks.map(mapSeg),
    slope: lw.slope
      ? {
          tail: tp(lw.slope.tail[0], lw.slope.tail[1]),
          head: tp(lw.slope.head[0], lw.slope.head[1]),
        }
      : null,
  }
}

/**
 * Roof-level floor-plan builder. Draws the whole merged-roof plan: the
 * unioned silhouette, the valley diagonals at concave junctions, and every
 * segment's ridge/hip/break linework — clipped so a line stops at the valley
 * where its segment overlaps a neighbour, instead of running on at the
 * segment's full length into the cut-away part.
 *
 * Drawing all the linework here (rather than per-segment) is what lets the
 * clip work: the valleys and the neighbouring footprints are all in hand, so
 * each line can be trimmed to the actual merged geometry. The segment
 * builder keeps only its hit-target / selection chrome.
 *
 * Composition uses the floor plan's negated-rotation convention
 * (segment-local → roof-local → plan). `unionPolygons` returns one ring per
 * disjoint group, so non-touching segments each keep their own outline. The
 * group is decorative (`pointerEvents: 'none'`) — clicks fall through to the
 * segment hit-targets.
 */
export function buildRoofFloorplan(node: RoofNode, ctx: GeometryContext): FloorplanGeometry | null {
  const segments = ctx.children.filter((c): c is RoofSegmentNode => c.type === 'roof-segment')
  if (segments.length === 0) return null

  const plans = segments.map((s) => buildSegPlan(node, s))
  const rings = unionPolygons(plans.map((p) => p.footprint)) as Pt[][]
  if (rings.length === 0) return null

  // Valleys at concave (reflex) corners of the merged outline. Each runs
  // along the interior angle bisector and terminates at the nearest segment
  // ridge — the diagonal where two merged slopes meet.
  const allRidges: Seg[] = plans.flatMap((p) => p.ridges)
  const valleys: Seg[] = []
  for (const ring of rings) {
    const n = ring.length
    if (n < 3) continue
    const orient = signedArea(ring) > 0 ? 1 : -1
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n] as Pt
      const V = ring[i] as Pt
      const next = ring[(i + 1) % n] as Pt
      const ax = prev[0] - V[0]
      const az = prev[1] - V[1]
      const bx = next[0] - V[0]
      const bz = next[1] - V[1]
      if ((ax * bz - az * bx) * orient <= 0) continue // not reflex
      const la = Math.hypot(ax, az) || 1
      const lb = Math.hypot(bx, bz) || 1
      let dx = -(ax / la + bx / lb)
      let dz = -(az / la + bz / lb)
      const dl = Math.hypot(dx, dz)
      if (dl < 1e-6) continue
      dx /= dl
      dz /= dl
      let bestT = Number.POSITIVE_INFINITY
      for (const [A, B] of allRidges) {
        const t = rayHitT(V[0], V[1], dx, dz, A[0], A[1], B[0], B[1])
        if (t !== null && t > 1e-4 && t < bestT) bestT = t
      }
      if (!Number.isFinite(bestT)) continue
      valleys.push([
        [V[0], V[1]],
        [V[0] + dx * bestT, V[1] + dz * bestT],
      ])
    }
  }

  const view = ctx.viewState
  const palette = view?.palette
  const showSelectedChrome = (view?.selected ?? false) || (view?.highlighted ?? false)
  const ink = showSelectedChrome && palette ? palette.selectedStroke : '#111111'
  const eaveWidth = showSelectedChrome ? 0.04 : 0.03
  const ridgeWidth = showSelectedChrome ? 0.05 : 0.038
  const hipWidth = showSelectedChrome ? 0.04 : 0.026

  const children: FloorplanGeometry[] = []
  const pushLine = (a: Pt, b: Pt, width: number) => {
    children.push({
      kind: 'line',
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      stroke: ink,
      strokeWidth: width,
      strokeLinecap: 'round',
      pointerEvents: 'none',
    })
  }

  // Merged outline (eaves).
  for (const ring of rings) {
    if (ring.length < 3) continue
    children.push({
      kind: 'polygon',
      points: ring.map(([x, z]) => [x, z] as FloorplanPoint),
      fill: 'none',
      stroke: ink,
      strokeWidth: eaveWidth,
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
    })
  }

  // Valley diagonals.
  for (const v of valleys) pushLine(v[0], v[1], hipWidth)

  // Per-segment ridge / hip / break linework, clipped to the merged geometry:
  // an endpoint that overshoots into another segment is pulled back to the
  // valley it crosses (the junction), so a ridge stops at the diagonal.
  const footprints = plans.map((p) => p.footprint)
  const clipEnd = (pt: Pt, other: Pt, ownIndex: number): Pt => {
    let inOther = false
    for (let i = 0; i < footprints.length; i++) {
      if (i === ownIndex) continue
      if (pointInPolygon(pt[0], pt[1], footprints[i] as Pt[])) {
        inOther = true
        break
      }
    }
    if (!inOther) return pt
    let bestT = Number.POSITIVE_INFINITY // nearest valley crossing to the overshoot
    for (const v of valleys) {
      const t = segCrossT(pt, other, v[0], v[1])
      if (t !== null && t < bestT) bestT = t
    }
    if (!Number.isFinite(bestT)) return pt // overshoots but no valley to stop at
    return [pt[0] + (other[0] - pt[0]) * bestT, pt[1] + (other[1] - pt[1]) * bestT]
  }
  const clipPush = (line: Seg, width: number, ownIndex: number) => {
    const a = clipEnd(line[0], line[1], ownIndex)
    const b = clipEnd(line[1], a, ownIndex)
    const dx = a[0] - b[0]
    const dz = a[1] - b[1]
    if (dx * dx + dz * dz < 1e-8) return
    pushLine(a, b, width)
  }

  plans.forEach((p, idx) => {
    for (const s of p.breaks) clipPush(s, hipWidth, idx)
    for (const s of p.hips) clipPush(s, hipWidth, idx)
    for (const s of p.ridges) clipPush(s, ridgeWidth, idx)

    // Shed downslope arrow (no overshoot to clip).
    if (p.slope) {
      const { tail, head } = p.slope
      const dx = head[0] - tail[0]
      const dz = head[1] - tail[1]
      const len = Math.hypot(dx, dz) || 1
      const ux = dx / len
      const uz = dz / len
      const headLen = Math.min(0.22, len * 0.4)
      const wing = headLen * 0.6
      pushLine(tail, head, hipWidth)
      children.push({
        kind: 'polyline',
        points: [
          [head[0] - headLen * ux - wing * uz, head[1] - headLen * uz + wing * ux],
          [head[0], head[1]],
          [head[0] - headLen * ux + wing * uz, head[1] - headLen * uz - wing * ux],
        ],
        stroke: ink,
        strokeWidth: hipWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        pointerEvents: 'none',
      })
    }
  })

  return children.length > 0 ? { kind: 'group', children } : null
}
