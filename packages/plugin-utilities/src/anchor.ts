import type { ServicePointNode } from './schema'
import type { LooseNode, LooseNodes } from './site-frame'

/**
 * Wall anchoring for `service-point`, mirroring the `bones:service` contract
 * (node_modules/@pascal-app/plugin-bones/src/service/placement.ts): a host
 * wall id plus a normalised `wallT` along `start → end` plus a mount height.
 *
 * A wall's `start` / `end` are LEVEL-local plan metres, and `LevelRenderer`
 * adds no transform, so level-local plan == building-local plan. That is the
 * frame these helpers return; `site-frame.ts` converts to and from site
 * metres at the edges.
 *
 * Curved walls are refused (`curve` / `sagitta` present and non-zero): the
 * lerp below would leave the point off the wall face. Bones refuses them the
 * same way rather than approximating.
 */

export type WallGeom = {
  id: string
  start: [number, number]
  end: [number, number]
  thickness: number
  height: number
}

const asPair = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null
  const [x, y] = value
  return typeof x === 'number' && typeof y === 'number' ? [x, y] : null
}

export function wallGeom(node: LooseNode | undefined | null): WallGeom | null {
  if (!node || node.type !== 'wall') return null
  const start = asPair(node.start)
  const end = asPair(node.end)
  if (!(start && end)) return null
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6) return null
  const curve = node.curve
  if (typeof curve === 'number' && Math.abs(curve) > 1e-6) return null
  return {
    id: String(node.id ?? ''),
    start,
    end,
    thickness: typeof node.thickness === 'number' ? node.thickness : 0.15,
    height: typeof node.height === 'number' ? node.height : 2.4,
  }
}

/** Plan point at `t` along the wall centreline. */
export function wallPointAt(geom: WallGeom, t: number): [number, number] {
  const clamped = Math.min(1, Math.max(0, t))
  return [
    geom.start[0] + (geom.end[0] - geom.start[0]) * clamped,
    geom.start[1] + (geom.end[1] - geom.start[1]) * clamped,
  ]
}

/** Unit outward-left normal of the wall (plan). Either face; the caller picks a sign. */
export function wallNormal(geom: WallGeom): [number, number] {
  const dx = geom.end[0] - geom.start[0]
  const dz = geom.end[1] - geom.start[1]
  const length = Math.hypot(dx, dz) || 1
  return [dz / length, -dx / length]
}

/** Wall yaw about +Y, radians — a device mounted on it faces along the normal. */
export function wallYaw(geom: WallGeom): number {
  return Math.atan2(geom.end[1] - geom.start[1], geom.end[0] - geom.start[0])
}

export type WallProjection = {
  geom: WallGeom
  t: number
  /** Perpendicular distance from the wall centreline, metres (always ≥ 0). */
  distance: number
  /** +1 when the point lies on the `wallNormal` side, −1 on the other. */
  side: 1 | -1
  point: [number, number]
}

/** Project a building-local plan point onto a wall's centreline. */
export function projectOntoWall(geom: WallGeom, point: readonly [number, number]): WallProjection {
  const dx = geom.end[0] - geom.start[0]
  const dz = geom.end[1] - geom.start[1]
  const lengthSq = dx * dx + dz * dz || 1
  const raw = ((point[0] - geom.start[0]) * dx + (point[1] - geom.start[1]) * dz) / lengthSq
  const t = Math.min(1, Math.max(0, raw))
  const on = wallPointAt(geom, t)
  const normal = wallNormal(geom)
  const offX = point[0] - on[0]
  const offZ = point[1] - on[1]
  const signed = offX * normal[0] + offZ * normal[1]
  return {
    geom,
    t,
    distance: Math.hypot(offX, offZ),
    side: signed >= 0 ? 1 : -1,
    point: on,
  }
}

/**
 * Nearest wall to a building-local plan point, within `maxDistance` metres.
 * Every wall in the scene is considered — a service point can land on an
 * upper-storey wall, and refusing that would silently drop valid placements.
 */
export function nearestWall(
  nodes: LooseNodes,
  point: readonly [number, number],
  maxDistance = 1.5,
): WallProjection | null {
  let best: WallProjection | null = null
  for (const node of Object.values(nodes)) {
    const geom = wallGeom(node)
    if (!geom) continue
    const projection = projectOntoWall(geom, point)
    if (projection.distance > maxDistance) continue
    if (!best || projection.distance < best.distance) best = projection
  }
  return best
}

export type ResolvedServicePoint = {
  /** Building-local `[x, y, z]` where the device body sits. */
  local: [number, number, number]
  /** Yaw about +Y so the device faces off the wall. 0 for free-standing. */
  yaw: number
  wall: WallGeom | null
}

/**
 * Tolerance for "`position` is still the default sentinel `[0, 0, 0]`".
 * 1 mm — below any placement a user can express, above float noise.
 */
export const SENTINEL_POSITION_EPSILON = 1e-3

/** True while `position` has never been written off its `[0, 0, 0]` default. */
export function isSentinelPosition(position: readonly [number, number, number]): boolean {
  return (
    Math.abs(position[0]) < SENTINEL_POSITION_EPSILON &&
    Math.abs(position[1]) < SENTINEL_POSITION_EPSILON &&
    Math.abs(position[2]) < SENTINEL_POSITION_EPSILON
  )
}

/**
 * Where a service point actually is, in BUILDING-LOCAL metres.
 *
 * A resolving wall anchor wins WHILE `position` is the sentinel; a `position`
 * written off the sentinel outranks it (schema.ts states the rule and why —
 * short version: the host move tool previews a drag through `position` alone,
 * so an always-winning anchor freezes the meter mid-drag). The commit side of
 * that gesture re-anchors and resets `position`, so a wall-mounted point
 * spends its resting life on the anchor branch.
 *
 * `siteToLocalPosition` is passed in rather than imported so this stays a
 * pure function of its arguments.
 */
export function resolveServicePoint(
  nodes: LooseNodes,
  node: ServicePointNode,
  siteToLocalPosition: (position: readonly [number, number, number]) => [number, number, number],
): ResolvedServicePoint {
  const geom = node.wallId ? wallGeom(nodes[node.wallId]) : null
  if (geom && typeof node.wallT === 'number' && isSentinelPosition(node.position)) {
    const on = wallPointAt(geom, node.wallT)
    const normal = wallNormal(geom)
    // Sit the body just proud of the wall face rather than inside it.
    const standoff = geom.thickness / 2 + 0.06
    return {
      local: [on[0] + normal[0] * standoff, node.height, on[1] + normal[1] * standoff],
      // three.js rotates local +Z to (sin θ, 0, cos θ), so facing the wall
      // normal (nx, nz) is θ = atan2(nx, nz).
      yaw: Math.atan2(normal[0], normal[1]),
      wall: geom,
    }
  }
  return { local: siteToLocalPosition(node.position), yaw: 0, wall: null }
}
