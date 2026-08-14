import type { AnyNodeId, BeamNode } from '@pascal-app/core'
import type { FencePlanPoint } from '@pascal-app/editor'

/**
 * Shared linked-beam cascade — the "meeting beams" relation walls get via
 * their endpoint-match planner, but deliberately lean: a beam dragging an
 * endpoint carries every sibling beam that shares that corner with it, and
 * the junction stays a single point. No bridge creation, no pivot planning —
 * a beam join is just two centreline corners coinciding.
 *
 * Used by BOTH the 3D `moveBeamEndpointDragAction` (scene writes per tick,
 * single-undo commit) and the 2D `beamMoveEndpointAffordance` (live
 * overrides per tick, tracked commit), so the collection + cascade rules
 * live here once instead of drifting apart.
 */

export type BeamPlanPoint = FencePlanPoint

/** Deep-copied snapshot of a sibling beam sharing an endpoint with the
 *  dragged beam, captured at drag start. */
export type LinkedBeamSnapshot = {
  id: AnyNodeId
  start: BeamPlanPoint
  end: BeamPlanPoint
}

const POINT_EPSILON = 1e-6

export function sameBeamPoint(a: BeamPlanPoint, b: BeamPlanPoint) {
  return Math.abs(a[0] - b[0]) <= POINT_EPSILON && Math.abs(a[1] - b[1]) <= POINT_EPSILON
}

/**
 * Sibling beams (same parent) that share either of the dragged beam's
 * endpoints. Excludes the dragged beam itself. The caller collects the
 * sibling list from the scene (the store's index type is a branded union,
 * so the filter lives where the narrowing compiles).
 */
export function collectLinkedBeams(
  beams: BeamNode[],
  beamId: AnyNodeId,
  parentId: string | null,
  start: BeamPlanPoint,
  end: BeamPlanPoint,
): LinkedBeamSnapshot[] {
  const linked: LinkedBeamSnapshot[] = []
  for (const beam of beams) {
    if (beam.id === beamId) continue
    if ((beam.parentId ?? null) !== parentId) continue
    if (
      sameBeamPoint(beam.start, start) ||
      sameBeamPoint(beam.start, end) ||
      sameBeamPoint(beam.end, start) ||
      sameBeamPoint(beam.end, end)
    ) {
      linked.push({
        id: beam.id as AnyNodeId,
        start: [...beam.start] as BeamPlanPoint,
        end: [...beam.end] as BeamPlanPoint,
      })
    }
  }
  return linked
}

/** The linked beams attached to the corner being dragged — they cascade with
 *  the drag, so their pre-drag coordinates are stale snap/alignment targets
 *  and must be excluded while attached. */
export function linkedBeamsAtMovingCorner(
  linked: LinkedBeamSnapshot[],
  movingPoint: BeamPlanPoint,
): AnyNodeId[] {
  return linked
    .filter(
      (beam) => sameBeamPoint(beam.start, movingPoint) || sameBeamPoint(beam.end, movingPoint),
    )
    .map((beam) => beam.id)
}

/**
 * Cascade updates for the linked beams given the dragged beam's final
 * endpoints. Only beams sharing the MOVING corner cascade — the junction
 * tracks the drag. Beams linked at the FIXED corner are untouched (they stay
 * valid snap/alignment anchors and never carry a no-op write).
 */
export function cascadeLinkedBeamUpdates(
  linked: LinkedBeamSnapshot[],
  originalStart: BeamPlanPoint,
  originalEnd: BeamPlanPoint,
  movingEndpoint: 'start' | 'end',
  nextStart: BeamPlanPoint,
  nextEnd: BeamPlanPoint,
): Array<{ id: AnyNodeId; start: BeamPlanPoint; end: BeamPlanPoint }> {
  const nextMovingPoint = movingEndpoint === 'start' ? nextStart : nextEnd
  const originalMovingPoint = movingEndpoint === 'start' ? originalStart : originalEnd
  return linked
    .filter(
      (beam) =>
        sameBeamPoint(beam.start, originalMovingPoint) ||
        sameBeamPoint(beam.end, originalMovingPoint),
    )
    .map((beam) => ({
      id: beam.id,
      start: sameBeamPoint(beam.start, originalMovingPoint) ? nextMovingPoint : beam.start,
      end: sameBeamPoint(beam.end, originalMovingPoint) ? nextMovingPoint : beam.end,
    }))
}
