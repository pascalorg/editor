import type { WallNode } from '../schema/nodes/wall'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { isCurvedWall } from '../systems/wall/wall-curve'

/**
 * Pure plan-space wall-distance math shared by the 2D opening snap
 * (`findClosestWallInPlan` in @pascal-app/nodes) and the editor's 2D
 * Voronoi debug overlay. One source of truth means the overlay is a
 * faithful picture of what the snap actually decides.
 *
 * A wall segment's Voronoi cell is exactly "the points whose nearest wall
 * is this segment", so nearest-segment classification == the segment
 * Voronoi diagram. Curved walls are excluded (the opening snap rejects
 * them — mitering + arc + opening tears in 3D).
 */

/**
 * Max cursor-to-wall plan distance (metres) for a 2D opening to snap onto a
 * wall. Tight, because plan walls are thin and often close together — a large
 * radius would let a far wall's region reach across a nearer one. Shared so the
 * snap and the Voronoi debug overlay clip to the exact same range.
 */
export const WALL_SNAP_DISTANCE_M = 0.4

export type WallSegment = {
  wall: WallNode
  /** [x, z] plan start. */
  start: readonly [number, number]
  /** [x, z] plan end. */
  end: readonly [number, number]
  /** Unit direction (start → end) in plan. */
  dirX: number
  dirY: number
  /** Segment length in metres. */
  length: number
}

export type WallSegmentClosest = {
  segment: WallSegment
  /** Distance from the query point to the closest point on the segment. */
  distance: number
  /** Distance along the wall from `start`, clamped to [0, length]. */
  along: number
  /** Signed perpendicular offset from the wall axis (+ on the front side). */
  perp: number
}

/**
 * Collect the straight (non-curved) wall segments that are direct children
 * of a level — the candidates an opening can snap onto.
 */
export function collectLevelWallSegments(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: AnyNodeId | null,
): WallSegment[] {
  if (!levelId) return []
  const level = nodes[levelId]
  const childIds = (level as unknown as { children?: AnyNodeId[] })?.children
  if (!Array.isArray(childIds)) return []

  const segments: WallSegment[] = []
  for (const childId of childIds) {
    const node = nodes[childId]
    if (node?.type !== 'wall') continue
    const wall = node as WallNode
    if (isCurvedWall(wall)) continue
    const dx = wall.end[0] - wall.start[0]
    const dy = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) continue
    segments.push({
      wall,
      start: wall.start,
      end: wall.end,
      dirX: dx / length,
      dirY: dy / length,
      length,
    })
  }
  return segments
}

/** Closest point + signed offset of one query point against one segment. */
export function closestOnSegment(
  segment: WallSegment,
  pointX: number,
  pointY: number,
): { distance: number; along: number; perp: number } {
  const px = pointX - segment.start[0]
  const py = pointY - segment.start[1]
  const along = Math.max(0, Math.min(segment.length, px * segment.dirX + py * segment.dirY))
  const perp = px * -segment.dirY + py * segment.dirX
  const closestX = segment.start[0] + segment.dirX * along
  const closestY = segment.start[1] + segment.dirY * along
  const distance = Math.hypot(pointX - closestX, pointY - closestY)
  return { distance, along, perp }
}

/**
 * The single nearest wall segment to a plan point — its Voronoi cell. Returns
 * null when `segments` is empty or (when `maxDistance` is given) nothing is
 * within range. Ties resolve to the first segment scanned; callers pass an
 * already-curved-filtered list from `collectLevelWallSegments`.
 */
export function nearestWallSegment(
  segments: readonly WallSegment[],
  pointX: number,
  pointY: number,
  maxDistance = Number.POSITIVE_INFINITY,
  excludeWallId?: AnyNodeId,
): WallSegmentClosest | null {
  let best: WallSegmentClosest | null = null
  for (const segment of segments) {
    if (excludeWallId && segment.wall.id === excludeWallId) continue
    const { distance, along, perp } = closestOnSegment(segment, pointX, pointY)
    if (distance > maxDistance) continue
    if (best && distance >= best.distance) continue
    best = { segment, distance, along, perp }
  }
  return best
}
