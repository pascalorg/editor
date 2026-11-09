import { boxesMeet } from './pieces'
import type { Prism } from './types'

/** [x0, z0, x1, z1] */
export type Aabb = [number, number, number, number]

/**
 * A prism seen from above for a body in one height band: its rings as a flat edge list (outer and
 * holes, even-odd), so the signed distance to it is the distance to the nearest edge, negative
 * inside.
 */
export type Obstacle = {
  index: number
  prism: Prism
  /** a.x, a.z, b.x, b.z for every edge. */
  edges: Float64Array
  aabb: Aabb
}

export function obstacleOf(prism: Prism, index: number): Obstacle {
  const rings = [prism.outer, ...prism.holes]
  let n = 0
  for (const ring of rings) n += ring.length
  const edges = new Float64Array(n * 4)
  let k = 0
  let x0 = Number.POSITIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      edges[k++] = a[0]
      edges[k++] = a[1]
      edges[k++] = b[0]
      edges[k++] = b[1]
      x0 = Math.min(x0, a[0])
      x1 = Math.max(x1, a[0])
      z0 = Math.min(z0, a[1])
      z1 = Math.max(z1, a[1])
    }
  return { index, prism, edges, aabb: [x0, z0, x1, z1] }
}

/** Signed distance to a set of rings given as flat edges: exact, negative inside (even-odd). */
export function signedDistance(edges: Float64Array, px: number, pz: number): number {
  let d2 = Number.POSITIVE_INFINITY
  let inside = false
  for (let k = 0; k < edges.length; k += 4) {
    const ax = edges[k]!
    const az = edges[k + 1]!
    const bx = edges[k + 2]!
    const bz = edges[k + 3]!
    const ex = bx - ax
    const ez = bz - az
    const wx = px - ax
    const wz = pz - az
    const length2 = ex * ex + ez * ez
    let t = length2 > 0 ? (wx * ex + wz * ez) / length2 : 0
    t = Math.min(1, Math.max(0, t))
    const dx = wx - ex * t
    const dz = wz - ez * t
    const q = dx * dx + dz * dz
    if (q < d2) d2 = q
    if (az > pz !== bz > pz && px < ax + ((pz - az) * ex) / ez) inside = !inside
  }
  const d = Math.sqrt(d2)
  return inside ? -d : d
}

export const obstacleDistance = (o: Obstacle, px: number, pz: number) =>
  signedDistance(o.edges, px, pz)

/** The closest point of an obstacle's edges to a point, and how far. */
export function closestOnEdges(
  edges: Float64Array,
  px: number,
  pz: number,
): { x: number; z: number; d: number } {
  let d2 = Number.POSITIVE_INFINITY
  let cx = 0
  let cz = 0
  for (let k = 0; k < edges.length; k += 4) {
    const ax = edges[k]!
    const az = edges[k + 1]!
    const ex = edges[k + 2]! - ax
    const ez = edges[k + 3]! - az
    const length2 = ex * ex + ez * ez
    let t = length2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / length2 : 0
    t = Math.min(1, Math.max(0, t))
    const qx = ax + ex * t
    const qz = az + ez * t
    const q = (px - qx) ** 2 + (pz - qz) ** 2
    if (q < d2) {
      d2 = q
      cx = qx
      cz = qz
    }
  }
  return { x: cx, z: cz, d: Math.sqrt(d2) }
}

export type Band = { z0: number; z1: number }

/**
 * The prisms a body standing in the band bumps into: those whose height range meets it, within
 * the plan window if one is given. A prism that only touches the band's edge does not count.
 */
export function obstaclesInBand(
  prisms: Iterable<Prism>,
  band: Band,
  window?: Aabb,
  skip?: (prism: Prism) => boolean,
): Obstacle[] {
  const out: Obstacle[] = []
  for (const prism of prisms) {
    if (!(prism.z1 > band.z0 + 1e-6 && prism.z0 < band.z1 - 1e-6)) continue
    if (skip?.(prism)) continue
    const obstacle = obstacleOf(prism, out.length)
    if (window) {
      const [a0, b0, a1, b1] = obstacle.aabb
      if (a1 < window[0] || a0 > window[2] || b1 < window[1] || b0 > window[3]) continue
    }
    out.push(obstacle)
  }
  return out
}

/** How far a ray from a point goes before it meets an obstacle's outline, at most `max`. */
export function rayHit(
  from: [number, number],
  dir: [number, number],
  obstacles: readonly Obstacle[],
  max: number,
): number {
  let best = max
  const ex = from[0] + dir[0] * max
  const ez = from[1] + dir[1] * max
  const box = [
    Math.min(from[0], ex),
    Math.min(from[1], ez),
    Math.max(from[0], ex),
    Math.max(from[1], ez),
  ]
  for (const o of obstacles) {
    if (!boxesMeet(box, o.aabb)) continue
    for (let k = 0; k < o.edges.length; k += 4) {
      const ax = o.edges[k]!
      const az = o.edges[k + 1]!
      const sx = o.edges[k + 2]! - ax
      const sz = o.edges[k + 3]! - az
      const den = dir[0] * sz - dir[1] * sx
      if (Math.abs(den) < 1e-12) continue
      const t = ((ax - from[0]) * sz - (az - from[1]) * sx) / den
      const u = ((ax - from[0]) * dir[1] - (az - from[1]) * dir[0]) / den
      if (t >= 0 && t < best && u >= 0 && u <= 1) best = t
    }
  }
  return best
}

/** The exact distance between two obstacles' outlines (0 when they touch or overlap) and the two closest points. */
export function obstacleGap(
  a: Obstacle,
  b: Obstacle,
): { d: number; pa: [number, number]; pb: [number, number] } {
  if (
    signedDistance(a.edges, b.edges[0]!, b.edges[1]!) <= 0 ||
    signedDistance(b.edges, a.edges[0]!, a.edges[1]!) <= 0
  )
    return { d: 0, pa: [b.edges[0]!, b.edges[1]!], pb: [b.edges[0]!, b.edges[1]!] }
  let best = Number.POSITIVE_INFINITY
  let pa: [number, number] = [0, 0]
  let pb: [number, number] = [0, 0]
  for (const [from, to, swapped] of [
    [a, b, false],
    [b, a, true],
  ] as const)
    for (let k = 0; k < from.edges.length; k += 4) {
      const closest = closestOnEdges(to.edges, from.edges[k]!, from.edges[k + 1]!)
      if (closest.d < best) {
        best = closest.d
        const here: [number, number] = [from.edges[k]!, from.edges[k + 1]!]
        const there: [number, number] = [closest.x, closest.z]
        pa = swapped ? there : here
        pb = swapped ? here : there
      }
    }
  return { d: best, pa, pb }
}

/**
 * The two obstacles that make the passage at a point: the nearest one, and the nearest one whose
 * closest point lies on the other side of the point. The passage is their exact distance, whatever
 * the grid said.
 */
export function passagePair(
  obstacles: Obstacle[],
  px: number,
  pz: number,
  reach = 1.5,
): { width: number; a: Obstacle; b: Obstacle; pa: [number, number]; pb: [number, number] } | null {
  const near = obstacles
    .filter(
      (o) =>
        o.aabb[0] - reach <= px &&
        px <= o.aabb[2] + reach &&
        o.aabb[1] - reach <= pz &&
        pz <= o.aabb[3] + reach,
    )
    .map((o) => ({ o, ...closestOnEdges(o.edges, px, pz) }))
    .sort((u, v) => u.d - v.d)
  const first = near[0]
  if (!first) return null
  const second = near.find((n) => (n.x - px) * (first.x - px) + (n.z - pz) * (first.z - pz) < 0)
  if (!second) return null
  const gap = obstacleGap(first.o, second.o)
  return { width: gap.d, a: first.o, b: second.o, pa: gap.pa, pb: gap.pb }
}

/**
 * What bounds a width read at a point: the nearest obstacle a disc of `radius` there touches, to
 * within `slack`, and the nearest touching one on the other side of the point, if there is one.
 * The nearest obstacle alone when nothing else bounds the disc.
 */
export function boundingObstacles(
  obstacles: Obstacle[],
  px: number,
  pz: number,
  radius: number,
  slack = 0.03,
): Obstacle[] {
  const reach = radius + slack
  const touching = nearestNodes(obstacles, px, pz, 6, reach).filter(
    (o) => Math.abs(signedDistance(o.edges, px, pz)) <= reach,
  )
  const first = touching[0] ?? nearestNodes(obstacles, px, pz, 1)[0]
  if (!first) return []
  const at = closestOnEdges(first.edges, px, pz)
  const across = touching.find((o) => {
    const there = closestOnEdges(o.edges, px, pz)
    return (there.x - px) * (at.x - px) + (there.z - pz) * (at.z - pz) < 0
  })
  return across ? [first, across] : [first]
}

/** The `count` obstacles of different nodes nearest a point, nearest first. */
export function nearestNodes(
  obstacles: Obstacle[],
  px: number,
  pz: number,
  count: number,
  reach = 3,
): Obstacle[] {
  const seen = new Set<string>()
  const out: Obstacle[] = []
  const near = obstacles
    .filter(
      (o) =>
        o.aabb[0] - reach <= px &&
        px <= o.aabb[2] + reach &&
        o.aabb[1] - reach <= pz &&
        pz <= o.aabb[3] + reach,
    )
    .map((o) => ({ o, d: Math.abs(signedDistance(o.edges, px, pz)) }))
    .sort((a, b) => a.d - b.d)
  for (const { o } of near) {
    if (seen.has(o.prism.nodeId)) continue
    seen.add(o.prism.nodeId)
    out.push(o)
    if (out.length === count) break
  }
  return out
}
