import { arcRuns, insetPolygon } from '@pascal-app/core'
/**
 * The setback envelope in the 3D site — the same rules the site plan draws
 * (packages/editor/src/lib/floorplan/site-plan/geometry.ts: front edge,
 * edge roles, per-role setbacks, offset-line intersections), ported here
 * because the nodes package cannot import the editor. Pure.
 *
 * Steve (2026-09-07): "the setbacks, if we have those bring those in
 * black and dashed to the 3d view".
 */
export type Pt = readonly [number, number]
export type EdgeRole = 'front' | 'rear' | 'left' | 'right'
export type SetbackInputs = {
  front: number
  side: number
  rear: number
  left?: number
  right?: number
}

const EPS = 1e-9

export function polygonArea(points: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % points.length] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a) / 2
}

function signedArea(points: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Pt
    const q = points[(i + 1) % points.length] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export function isCounterClockwise(points: readonly Pt[]): boolean {
  return signedArea(points) > 0
}

/** Unit normal of edge i pointing OUT of the polygon (away from its centroid). */
export function outwardNormal(points: readonly Pt[], i: number): Pt {
  const n = points.length
  const p = points[i] as Pt
  const q = points[(i + 1) % n] as Pt
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const len = Math.hypot(dx, dy) || 1
  let nx = -dy / len
  let ny = dx / len
  let cx = 0
  let cy = 0
  for (const pt of points) {
    cx += pt[0]
    cy += pt[1]
  }
  cx /= n
  cy /= n
  const mx = (p[0] + q[0]) / 2
  const my = (p[1] + q[1]) / 2
  if ((mx - cx) * nx + (my - cy) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  return [nx, ny]
}

/** The most north-facing edge (plan up = −z = north, turned by `northRotation`). */
export function mostNorthFacingEdge(points: readonly Pt[], northRotation = 0): number {
  let best = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    const [nx, ny] = outwardNormal(points, i)
    // heading of the outward normal, degrees clockwise from north
    const heading = (((Math.atan2(nx, -ny) - northRotation) * 180) / Math.PI + 360) % 360
    const off = Math.min(heading, 360 - heading)
    if (off < bestScore) {
      bestScore = off
      best = i
    }
  }
  return best
}

export function resolveFrontEdge(points: readonly Pt[], frontEdge: number | undefined, northRotation = 0): number {
  if (typeof frontEdge === 'number' && Number.isInteger(frontEdge) && frontEdge >= 0 && frontEdge < points.length) return frontEdge
  return mostNorthFacingEdge(points, northRotation)
}

export function classifyEdges(points: readonly Pt[], frontIndex: number): EdgeRole[] {
  const n = points.length
  const roles: EdgeRole[] = new Array(n).fill('left')
  if (n === 0) return roles
  const front = ((frontIndex % n) + n) % n
  const fn = outwardNormal(points, front)
  let rear = -1
  let rearDot = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (i === front) continue
    const ni = outwardNormal(points, i)
    const dot = fn[0] * ni[0] + fn[1] * ni[1]
    if (dot < rearDot) {
      rearDot = dot
      rear = i
    }
  }
  const fp = points[front] as Pt
  const fq = points[(front + 1) % n] as Pt
  const dx = fq[0] - fp[0]
  const dy = fq[1] - fp[1]
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const fmx = (fp[0] + fq[0]) / 2
  const fmy = (fp[1] + fq[1]) / 2
  for (let i = 0; i < n; i++) {
    if (i === front) {
      roles[i] = 'front'
      continue
    }
    if (i === rear) {
      roles[i] = 'rear'
      continue
    }
    const p = points[i] as Pt
    const q = points[(i + 1) % n] as Pt
    const mx = (p[0] + q[0]) / 2 - fmx
    const my = (p[1] + q[1]) / 2 - fmy
    roles[i] = mx * ux + my * uy < 0 ? 'left' : 'right'
  }
  return roles
}

export function setbackForRole(setbacks: SetbackInputs, role: EdgeRole): number {
  switch (role) {
    case 'front':
      return setbacks.front
    case 'rear':
      return setbacks.rear
    case 'left':
      return setbacks.left ?? setbacks.side
    case 'right':
      return setbacks.right ?? setbacks.side
  }
}

/** The buildable envelope: every edge pushed inward by its role's setback (see the editor's copy for the rules). */
export function setbackEnvelope(points: readonly Pt[], setbacks: SetbackInputs, frontIndex: number): Pt[] {
  const n = points.length
  if (n < 3) return []
  const roles = classifyEdges(points, frontIndex)
  // a radius drawn as a run of short edges takes ONE role: the front's or
  // the rear's when it carries that edge, else each sliver keeps its side
  const runs = arcRuns(points)
  const runRole = new Map<number, EdgeRole>()
  for (let i = 0; i < n; i++) {
    const r = roles[i] as EdgeRole
    const g = runs[i] as number
    const have = runRole.get(g)
    if (r === 'front' || (r === 'rear' && have !== 'front')) runRole.set(g, r)
    else if (!have) runRole.set(g, r)
  }
  const distances: number[] = []
  for (let i = 0; i < n; i++) {
    const role = runRole.get(runs[i] as number) ?? (roles[i] as EdgeRole)
    const d = setbackForRole(setbacks, role === 'left' || role === 'right' ? (roles[i] as EdgeRole) : role)
    if (!Number.isFinite(d) || d < 0) return []
    distances.push(d)
  }
  // the true inward offset (core setback-envelope.ts): straight where the
  // lot is straight, concentric round a radius, clipped where the offsets
  // cross — Steve, 2026-09-08: "industry standard for setback on pie
  // shape, radius corners, and odd lots"
  return insetPolygon(points, distances)
}
