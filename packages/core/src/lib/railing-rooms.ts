import type { WallNode } from '../schema'
import { isRailingWall } from '../schema/nodes/railing-wall'
import type { BoundarySpan } from './room-topology-index'

/** Span overlap below this (a fraction of the boundary) is a shared endpoint, not a shared edge. */
const SPAN_OVERLAP = 1e-6

/** The ids of the railing walls among `walls`. */
export function railingWallIds(walls: readonly WallNode[]): Set<string> {
  return new Set(walls.flatMap((wall) => (isRailingWall(wall) ? [wall.id] : [])))
}

/**
 * The rooms a railing fences off from the outside: a railing on the room's edge with no room
 * standing behind some stretch of it (a deck's or a porch's guard on the storey's outline). A
 * railing is a guard, not an enclosure, so such a room is outside whatever covers it, and a wall
 * it shares with the house faces outdoors. A railing with rooms on both faces (round a stair well,
 * along a loft) leaves them inside.
 */
export function railingFencedRoomIds(
  spans: readonly BoundarySpan[],
  railingIds: ReadonlySet<string>,
): Set<string> {
  const railings = spans.filter((span) => span.kind === 'wall' && railingIds.has(span.boundaryId))
  const fenced = new Set<string>()
  for (const span of railings) {
    const behind = railings
      .filter(
        (other) =>
          other.boundaryId === span.boundaryId &&
          other.face !== span.face &&
          Math.min(span.t1, other.t1) - Math.max(span.t0, other.t0) > SPAN_OVERLAP,
      )
      .sort((a, b) => a.t0 - b.t0)
    let reach = span.t0
    let open = false
    for (const other of behind) {
      if (other.t0 > reach + SPAN_OVERLAP) {
        open = true
        break
      }
      reach = Math.max(reach, other.t1)
    }
    if (open || reach < span.t1 - SPAN_OVERLAP) fenced.add(span.roomId)
  }
  return fenced
}
