import { arcRuns, insetPolygon, type KeepOut, sightTriangle, streetCorners } from '@pascal-app/core'
/**
 * The setback envelope in the 3D site — the same rules the site plan draws
 * (packages/editor/src/lib/floorplan/site-plan/geometry.ts: front edge,
 * edge roles, per-role setbacks, offset-line intersections), ported here
 * because the nodes package cannot import the editor. Pure. When the site
 * has setbacks, the 3D view draws them black and dashed.
 */
export type Pt = readonly [number, number]
export type EdgeRole = 'front' | 'rear' | 'left' | 'right' | 'street'
export type SetbackInputs = {
  front: number
  side: number
  rear: number
  left?: number
  right?: number
  /** A corner lot's second street side; absent = the front setback. */
  streetSide?: number
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

export function classifyEdges(points: readonly Pt[], frontIndex: number, streetEdges: readonly number[] = []): EdgeRole[] {
  const n = points.length
  const roles: EdgeRole[] = new Array(n).fill('left')
  if (n === 0) return roles
  const front = ((frontIndex % n) + n) % n
  const fn = outwardNormal(points, front)
  // a corner lot's other street edges (the parcel fabric's frontage) are
  // 'street' — they take the street-side setback, never a side yard, and
  // the rear is never one of them
  const street = new Set(streetEdges.map((i) => ((i % n) + n) % n))
  street.delete(front)
  let rear = -1
  let rearDot = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i++) {
    if (i === front || street.has(i)) continue
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
    if (street.has(i)) {
      roles[i] = 'street'
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
    case 'street':
      return setbacks.streetSide ?? setbacks.front
    case 'rear':
      return setbacks.rear
    case 'left':
      return setbacks.left ?? setbacks.side
    case 'right':
      return setbacks.right ?? setbacks.side
  }
}

/** The buildable envelope: every edge pushed inward by its role's setback (see the editor's copy for the rules). */
export function setbackEnvelope(points: readonly Pt[], setbacks: SetbackInputs, frontIndex: number, options: { streetEdges?: readonly number[]; sightTriangleM?: number } = {}): Pt[] {
  const n = points.length
  if (n < 3) return []
  const streetEdges = options.streetEdges ?? []
  const roles = classifyEdges(points, frontIndex, streetEdges)
  // A radius drawn as a run of short edges takes ONE role. A curb return
  // is street frontage: a run carrying, or touching, a front / street edge
  // is front / street all along (otherwise the last sliver of the return
  // became a side yard, and the envelope jutted out toward the corner); a
  // run carrying the rear is rear; else each sliver keeps its own side.
  const runs = arcRuns(points)
  const runRole = new Map<number, EdgeRole>()
  const streetLike = (r: EdgeRole) => r === 'front' || r === 'street'
  for (let i = 0; i < n; i++) {
    const r = roles[i] as EdgeRole
    const g = runs[i] as number
    const have = runRole.get(g)
    if (streetLike(r) || (r === 'rear' && !(have && streetLike(have)))) runRole.set(g, r)
    else if (!have) runRole.set(g, r)
  }
  for (let i = 0; i < n; i++) {
    const g = runs[i] as number
    const have = runRole.get(g) as EdgeRole
    if (streetLike(have)) continue
    const before = roles[(i - 1 + n) % n] as EdgeRole
    const after = roles[(i + 1) % n] as EdgeRole
    const members = runs.filter((x) => x === g).length
    if (members > 1) {
      if (runs[(i - 1 + n) % n] !== g && streetLike(before)) runRole.set(g, before)
      else if (runs[(i + 1) % n] !== g && streetLike(after)) runRole.set(g, after)
    }
  }
  const distances: number[] = []
  for (let i = 0; i < n; i++) {
    const role = runRole.get(runs[i] as number) ?? (roles[i] as EdgeRole)
    const d = setbackForRole(setbacks, role === 'left' || role === 'right' ? (roles[i] as EdgeRole) : role)
    if (!Number.isFinite(d) || d < 0) return []
    distances.push(d)
  }
  // the corner sight triangles keep the envelope out of the clear-vision
  // zone at each street intersection (the hypotenuse is a half-plane)
  const keepOut: KeepOut[] = []
  if (options.sightTriangleM && options.sightTriangleM > 0) {
    for (const [a, b] of streetCorners(points, [frontIndex, ...streetEdges])) {
      const tri = sightTriangle(points, a, b, options.sightTriangleM)
      if (tri) keepOut.push({ a: tri.a, b: tri.b, inside: tri.corner })
    }
  }
  // the true inward offset (core setback-envelope.ts): straight where the
  // lot is straight, concentric round a radius, clipped where the offsets
  // cross — the industry-standard setback for pie shapes, radius corners
  // and odd lots
  return insetPolygon(points, distances, { keepOut })
}
