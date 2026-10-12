import { getGableRidge, type RoofSegmentNode } from './roof-segment'

export type RoofPlanRing = [number, number][]

type OutlineInput = Pick<
  RoofSegmentNode,
  'width' | 'depth' | 'wallThickness' | 'footprint' | 'coverFootprint'
>

/**
 * The outer face of the walls a segment stands on, segment-local: its drawn
 * outline, else its rectangle pushed out by half the wall thickness.
 */
export function getRoofSegmentWallOutline(node: OutlineInput): RoofPlanRing {
  if (node.footprint && node.footprint.length >= 3) {
    return node.footprint.map(([x, z]) => [x, z])
  }
  const x = node.width / 2 + node.wallThickness / 2
  const z = node.depth / 2 + node.wallThickness / 2
  return [
    [-x, -z],
    [x, -z],
    [x, z],
    [-x, z],
  ]
}

/**
 * What the roof covers, segment-local: past the walls where it was pulled out
 * as a canopy. A wall corner on one of its edges splits that edge there, so a
 * canopy reaching on past the wall line has a side of its own to pull.
 */
export function getRoofSegmentCoverOutline(node: OutlineInput): RoofPlanRing {
  if (!(node.coverFootprint && node.coverFootprint.length >= 3)) {
    return getRoofSegmentWallOutline(node)
  }
  const cover = node.coverFootprint
  const walls = getRoofSegmentWallOutline(node)
  const ring: RoofPlanRing = []
  for (let i = 0; i < cover.length; i++) {
    const [ax, az] = cover[i]!
    const [bx, bz] = cover[(i + 1) % cover.length]!
    ring.push([ax, az])
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-9) continue
    const ux = (bx - ax) / length
    const uz = (bz - az) / length
    const inner = walls
      .map(([x, z]) => ({ t: (x - ax) * ux + (z - az) * uz, off: (x - ax) * uz - (z - az) * ux }))
      .filter(({ t, off }) => Math.abs(off) < 1e-6 && t > 1e-6 && t < length - 1e-6)
      .sort((p, q) => p.t - q.t)
    for (const { t } of inner) ring.push([ax + ux * t, az + uz * t])
  }
  return ring
}

function signedArea(ring: readonly (readonly [number, number])[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]!
    const [x2, z2] = ring[(i + 1) % ring.length]!
    area += x1 * z2 - x2 * z1
  }
  return area / 2
}

/** Unit outward normal of a ring edge (x, z), whichever way the ring winds. */
export function getRoofRingEdgeNormal(
  ring: readonly (readonly [number, number])[],
  edgeIndex: number,
): [number, number] {
  const [x1, z1] = ring[edgeIndex]!
  const [x2, z2] = ring[(edgeIndex + 1) % ring.length]!
  const length = Math.hypot(x2 - x1, z2 - z1) || 1
  const ccw = signedArea(ring) > 0
  const dx = (x2 - x1) / length
  const dz = (z2 - z1) / length
  return ccw ? [dz, -dx] : [-dz, dx]
}

const RING_EPSILON = 1e-6

/** An edge's start, end, unit direction, outward normal and length. */
function ringEdgeFrame(ring: RoofPlanRing, edgeIndex: number) {
  const p = ring[edgeIndex]!
  const q = ring[(edgeIndex + 1) % ring.length]!
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
  const u: [number, number] = [(q[0] - p[0]) / length, (q[1] - p[1]) / length]
  return { p, q, u, n: getRoofRingEdgeNormal(ring, edgeIndex), length }
}

/**
 * How far edge `edgeIndex` of `ring` may come in: up to the nearest of the
 * obstacles' edges behind it, across its own span (what only touches its ends
 * does not count). −Infinity when nothing is behind it.
 */
function inwardLimit(
  ring: RoofPlanRing,
  edgeIndex: number,
  obstacles: { ring: RoofPlanRing; skip?: number }[],
): number {
  const { p, u, n, length } = ringEdgeFrame(ring, edgeIndex)
  const local = ([x, z]: [number, number]) => {
    const dx = x - p[0]
    const dz = z - p[1]
    return { t: dx * u[0] + dz * u[1], s: dx * n[0] + dz * n[1] }
  }
  let limit = Number.NEGATIVE_INFINITY
  for (const { ring: other, skip } of obstacles) {
    for (let i = 0; i < other.length; i++) {
      if (i === skip) continue
      let a = local(other[i]!)
      let b = local(other[(i + 1) % other.length]!)
      if (a.t > b.t) [a, b] = [b, a]
      const lo = Math.max(a.t, RING_EPSILON)
      const hi = Math.min(b.t, length - RING_EPSILON)
      if (lo > hi) continue
      const at = (t: number) =>
        b.t - a.t < 1e-12 ? Math.max(a.s, b.s) : a.s + ((b.s - a.s) * (t - a.t)) / (b.t - a.t)
      for (const s of [at(lo), at(hi)]) {
        if (s <= RING_EPSILON) limit = Math.max(limit, Math.min(s, 0))
      }
    }
  }
  return limit
}

/**
 * The ring with no repeated points and no point where it turns straight back
 * on itself. Points on a straight run stay: a wall corner the covering was
 * pulled out from is still where it was.
 */
function tidyRing(ring: RoofPlanRing): RoofPlanRing {
  const points = ring.map(([x, z]) => [x, z] as [number, number])
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length]!
      const point = points[i]!
      const next = points[(i + 1) % points.length]!
      const ax = point[0] - prev[0]
      const az = point[1] - prev[1]
      const bx = next[0] - point[0]
      const bz = next[1] - point[1]
      const repeated = Math.hypot(ax, az) < RING_EPSILON
      const backtrack =
        Math.abs(ax * bz - az * bx) < RING_EPSILON * Math.max(1, Math.hypot(ax, az)) &&
        ax * bx + az * bz < 0
      if (repeated || backtrack) {
        points.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return points
}

/**
 * The covering with edge `edgeIndex` pulled `distance` along its outward
 * normal. An edge on the walls is pushed out as a new piece: its corners stay
 * on the walls and the piece grows out of them. An edge out past the walls
 * moves: at each end it slides along a neighbour running across it, and where
 * the neighbour runs on in its line (a piece's side against a wall corner)
 * that point stays and a new one leads out of it, so a piece's sides narrow or
 * widen that piece alone. The pulled edge keeps its index.
 */
function pullCoverEdge(
  cover: RoofPlanRing,
  walls: RoofPlanRing,
  edgeIndex: number,
  distance: number,
): RoofPlanRing {
  const count = cover.length
  const { p, q, u, n } = ringEdgeFrame(cover, edgeIndex)
  const onWalls = inwardLimit(cover, edgeIndex, [{ ring: walls }]) > -RING_EPSILON
  const inLine = (from: [number, number], to: [number, number]) =>
    Math.abs((to[0] - from[0]) * u[1] - (to[1] - from[1]) * u[0]) < RING_EPSILON
  const previous = cover[(edgeIndex - 1 + count) % count]!
  const next = cover[(edgeIndex + 2) % count]!
  const keepStart = onWalls || inLine(previous, p)
  const keepEnd = onWalls || inLine(q, next)

  const moved: [[number, number], [number, number]] = [
    [p[0] + n[0] * distance, p[1] + n[1] * distance],
    [q[0] + n[0] * distance, q[1] + n[1] * distance],
  ]
  // where the moved edge's line meets a neighbour's line
  const meet = (a: [number, number], b: [number, number], fallback: [number, number]) => {
    const [ex, ez] = [moved[1][0] - moved[0][0], moved[1][1] - moved[0][1]]
    const [fx, fz] = [b[0] - a[0], b[1] - a[1]]
    const denominator = ex * fz - ez * fx
    if (Math.abs(denominator) < 1e-12) return fallback
    const t = ((a[0] - moved[0][0]) * fz - (a[1] - moved[0][1]) * fx) / denominator
    return [moved[0][0] + ex * t, moved[0][1] + ez * t] as [number, number]
  }
  const start = keepStart ? moved[0] : meet(previous, p, moved[0])
  const end = keepEnd ? moved[1] : meet(q, next, moved[1])

  // the edge rebuilt at the head, then the rest of the ring from its end on
  const rebuilt: RoofPlanRing = [...(keepStart ? [p] : []), start, end, ...(keepEnd ? [q] : [])]
  for (let k = 2; k < count; k++) rebuilt.push(cover[(edgeIndex + k) % count]!)
  // turned so the pulled edge sits at its index again
  const head = keepStart ? 1 : 0
  const size = rebuilt.length
  const turned = rebuilt.map((_, k) => rebuilt[(((k - edgeIndex + head) % size) + size) % size]!)
  return tidyRing(turned)
}

/**
 * Pull one edge of what a gable covers out past the walls (or back toward
 * them) by `distance`, as a canopy: the slopes run on in their own planes,
 * the ridge keeps its place and height, and the roof's own walls stay on the
 * building. The segment is rebuilt over the rectangle bounding the walls and
 * the covering, so it moves and resizes with it. Null for anything but a
 * sloped gable.
 */
export function pullRoofSegmentCoverEdge(
  node: RoofSegmentNode,
  edgeIndex: number,
  distance: number,
): Partial<RoofSegmentNode> | null {
  const ridge = getGableRidge(node)
  if (!ridge) return null
  const walls = getRoofSegmentWallOutline(node)
  const cover = getRoofSegmentCoverOutline(node)
  if (edgeIndex < 0 || edgeIndex >= cover.length) return null
  // never in past the walls, nor through the covering's far side
  const limit = inwardLimit(cover, edgeIndex, [{ ring: walls }, { ring: cover, skip: edgeIndex }])
  const pulled = pullCoverEdge(cover, walls, edgeIndex, Math.max(limit, distance))

  // the rectangle the roof is built over: bounding the walls and the covering
  const points = [...walls, ...pulled]
  const minX = Math.min(...points.map(([x]) => x))
  const maxX = Math.max(...points.map(([x]) => x))
  const minZ = Math.min(...points.map(([, z]) => z))
  const maxZ = Math.max(...points.map(([, z]) => z))
  const shiftX = (minX + maxX) / 2
  const shiftZ = (minZ + maxZ) / 2
  const width = maxX - minX
  const depth = maxZ - minZ

  // the slope planes stay put: same ridge line and height, the +z eave moves
  // with the rectangle's edge down (or up) the front slope
  const ridgeZ = ridge.ridgeZ - shiftZ
  const ridgeOffset = depth / 2 - ridgeZ
  const wallHeight = ridge.height - ridgeOffset * Math.tan((ridge.frontPitch * Math.PI) / 180)

  // the segment's origin follows the rectangle's centre (rotation-y, as the roof renders it)
  const rotation = node.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const position: [number, number, number] = [
    node.position[0] + shiftX * cos + shiftZ * sin,
    node.position[1],
    node.position[2] - shiftX * sin + shiftZ * cos,
  ]
  const local = (ring: RoofPlanRing): RoofPlanRing => ring.map(([x, z]) => [x - shiftX, z - shiftZ])

  return {
    position,
    width,
    depth,
    wallHeight,
    ridgeOffset,
    backPitch: ridge.backPitch,
    footprint: local(walls),
    coverFootprint: local(pulled),
  }
}

/**
 * How far a gable's rectangle edges sit past the walls on its +z and −z
 * sides (a canopy pulled out there): the ridge group is read and edited
 * against the walls, not the canopy's edge.
 */
export function getGableWallInsets(node: OutlineInput): { front: number; back: number } {
  const walls = getRoofSegmentWallOutline(node)
  const maxZ = Math.max(...walls.map(([, z]) => z))
  const minZ = Math.min(...walls.map(([, z]) => z))
  return {
    front: Math.max(0, node.depth / 2 - maxZ),
    back: Math.max(0, node.depth / 2 + minZ),
  }
}
