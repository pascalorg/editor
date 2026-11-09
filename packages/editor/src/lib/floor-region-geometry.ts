import { area, containsPoint, intersection, type MultiPolygon } from '@pascal-app/core'
import type { FloorRegionPoint } from './floor-region-snap'

// Pure geometry for "Paint part of the floor": which room a plan point is in,
// the box a rectangle drag draws, crossing edges, and the clip to the room.

/** Smaller than this (m²) is a click, not a region. */
export const MIN_FLOOR_REGION_AREA = 0.01
export const CROSSING_MESSAGE = "Edges can't cross"
export const OUTSIDE_MESSAGE = 'Draw inside the room'

/** The first room (in the given order) whose clear floor holds the point. */
/**
 * The room whose clear floor holds `point`. Rooms can stack (a mezzanine over
 * its host): with `elevationOf`, the topmost floor wins, as the plan shows it
 * and as a 3D ray from above would land.
 */
export function floorRegionRoomAt<T extends { clearPolygon: MultiPolygon }>(
  rooms: readonly T[],
  point: FloorRegionPoint,
  elevationOf?: (room: T) => number,
): T | null {
  let best: T | null = null
  let bestElevation = Number.NEGATIVE_INFINITY
  for (const room of rooms) {
    if (!containsPoint(room.clearPolygon, point)) continue
    if (!elevationOf) return room
    const elevation = elevationOf(room)
    if (elevation > bestElevation) {
      best = room
      bestElevation = elevation
    }
  }
  return best
}

/**
 * The rectangle frame of a room: the direction of its longest boundary edge,
 * folded into [-45°, 45°) so an axis-aligned room reads exactly 0 and a box
 * drawn in a room at an angle follows the room.
 */
export function floorRegionAxisAngle(clear: MultiPolygon): number {
  let longest = 0
  let angle = 0
  for (const { outer } of clear) {
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!
      const b = outer[(i + 1) % outer.length]!
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length > longest + 1e-9) {
        longest = length
        angle = Math.atan2(b[1] - a[1], b[0] - a[0])
      }
    }
  }
  const quarter = Math.PI / 2
  let folded = angle - Math.round(angle / quarter) * quarter
  if (folded >= Math.PI / 4) folded -= quarter
  return Math.abs(folded) < 1e-9 ? 0 : folded
}

/** The box with opposite corners `start` and `end`, its sides along `angle` and across it. */
export function floorRegionRectangle(
  start: FloorRegionPoint,
  end: FloorRegionPoint,
  angle: number,
): FloorRegionPoint[] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  if (angle === 0)
    return [
      [start[0], start[1]],
      [end[0], start[1]],
      [end[0], end[1]],
      [start[0], end[1]],
    ]
  const ux = Math.cos(angle)
  const uz = Math.sin(angle)
  const along = dx * ux + dz * uz
  const across = -dx * uz + dz * ux
  const corner = (u: number, v: number): FloorRegionPoint => [
    start[0] + u * ux - v * uz,
    start[1] + u * uz + v * ux,
  ]
  return [corner(0, 0), corner(along, 0), corner(along, across), corner(0, across)]
}

function orientation(a: FloorRegionPoint, b: FloorRegionPoint, c: FloorRegionPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

const EPSILON = 1e-9

function onSegment(a: FloorRegionPoint, b: FloorRegionPoint, p: FloorRegionPoint) {
  return (
    Math.min(a[0], b[0]) - EPSILON <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    Math.min(a[1], b[1]) - EPSILON <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  )
}

/** Whether two segments touch or cross (end points included). */
export function segmentsTouch(
  a: FloorRegionPoint,
  b: FloorRegionPoint,
  c: FloorRegionPoint,
  d: FloorRegionPoint,
): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  const s = (value: number) => (Math.abs(value) < EPSILON ? 0 : Math.sign(value))
  if (s(o1) * s(o2) < 0 && s(o3) * s(o4) < 0) return true
  return (
    (s(o1) === 0 && onSegment(a, b, c)) ||
    (s(o2) === 0 && onSegment(a, b, d)) ||
    (s(o3) === 0 && onSegment(c, d, a)) ||
    (s(o4) === 0 && onSegment(c, d, b))
  )
}

/** Whether a segment folds back along its neighbour (shared end, overlapping). */
function foldsBack(shared: FloorRegionPoint, previous: FloorRegionPoint, next: FloorRegionPoint) {
  const cross = orientation(shared, previous, next)
  const dot =
    (previous[0] - shared[0]) * (next[0] - shared[0]) +
    (previous[1] - shared[1]) * (next[1] - shared[1])
  return Math.abs(cross) < EPSILON && dot > 0
}

/**
 * Whether adding `next` after the open path `points` makes an edge cross (or
 * fold back onto) an earlier one. With `closing`, `next` is the first point and
 * the new edge closes the ring.
 */
export function floorRegionEdgeCrosses(
  points: readonly FloorRegionPoint[],
  next: FloorRegionPoint,
  closing = false,
): boolean {
  const last = points.at(-1)
  if (!last) return false
  if (points.length >= 2 && foldsBack(last, points.at(-2)!, next)) return true
  if (closing && points.length >= 2 && foldsBack(points[0]!, points[1]!, last)) return true
  // Edges i → i+1 that do not share an end with the new edge.
  const firstEdge = closing ? 1 : 0
  for (let i = firstEdge; i < points.length - 2; i++)
    if (segmentsTouch(points[i]!, points[i + 1]!, last, next)) return true
  return false
}

/** Whether a closed ring has two edges that cross. */
export function floorRegionSelfIntersects(ring: readonly FloorRegionPoint[]): boolean {
  for (let i = 1; i < ring.length; i++)
    if (floorRegionEdgeCrosses(ring.slice(0, i), ring[i]!)) return true
  return ring.length >= 3 && floorRegionEdgeCrosses(ring, ring[0]!, true)
}

export type FloorRegionClip = {
  /** What gets stored: the clipped outline, or the drawn one when the room splits it. */
  polygon: FloorRegionPoint[]
  /** The painted pieces (what the floor will show). */
  pieces: MultiPolygon
  area: number
}

/**
 * Clips a drawn outline to the room's clear floor. One piece stores its outer
 * ring (the plate partition clips any hole, like a column, again at render).
 * When the room splits the outline into several pieces (a box across a
 * U-shaped room's notch), the drawn outline is stored as is: the renderer
 * intersects every region with the room, so all pieces paint in one region and
 * one undo step. Nothing inside the room, or less than a click's worth, is null.
 */
export function clipFloorRegion(
  polygon: readonly FloorRegionPoint[],
  clear: MultiPolygon,
): FloorRegionClip | null {
  if (polygon.length < 3) return null
  const ring = polygon.map(([x, z]) => [x, z] as FloorRegionPoint)
  const pieces = intersection(ring, clear)
  const clipped = area(pieces)
  if (clipped < MIN_FLOOR_REGION_AREA) return null
  return {
    polygon: pieces.length === 1 ? pieces[0]!.outer.map(([x, z]) => [x, z]) : ring,
    pieces,
    area: clipped,
  }
}
