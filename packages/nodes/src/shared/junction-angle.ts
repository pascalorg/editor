import {
  type FencePlanPoint,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
} from '@pascal-app/editor'

/**
 * Pure junction-angle picker shared by the beam and wall surfaces.
 *
 * Finds the first endpoint (start or end) of the dragged segment that meets
 * a neighbouring segment — a wall, a fence, or a same-kind sibling sharing
 * the junction — and returns the angle between them plus the label's world
 * position.
 *
 * The dragged segment itself is never in `segments`, so every candidate is
 * a genuine neighbour. React-free so the junction logic is unit-testable;
 * the 3D pills and the 2D floor-plan labels all consume the same picker so
 * the 2D ↔ 3D parity holds by construction.
 */

export type JunctionAngleSegment = {
  id: string
  start: FencePlanPoint
  end: FencePlanPoint
  curveOffset?: number
}

/**
 * Y at which the 3D angle pill floats above the junction. Fixed because the
 * wall and beam endpoint tools both use the same value.
 */
const PILL_Y = 0.34

export function pickJunctionAngleLabel(args: {
  targetId: string
  start: FencePlanPoint
  end: FencePlanPoint
  curveOffset?: number
  segments: JunctionAngleSegment[]
}): { label: string; position: [number, number, number] } | null {
  const { targetId, start, end, curveOffset, segments } = args
  const target: JunctionAngleSegment = { id: targetId, start, end, curveOffset }
  for (const endpoint of [start, end] as FencePlanPoint[]) {
    const targetRef = getSegmentAngleReferenceAtPoint(endpoint, target)
    if (!targetRef) continue
    const neighbour = segments.find((s) => Boolean(getSegmentAngleReferenceAtPoint(endpoint, s)))
    if (!neighbour) continue
    const neighbourRef = getSegmentAngleReferenceAtPoint(endpoint, neighbour)
    if (!neighbourRef) continue
    const angle = getAngleToSegmentReference(targetRef.vector, neighbourRef)
    if (angle === null) continue
    return {
      label: formatAngleRadians(angle),
      position: [endpoint[0], PILL_Y, endpoint[1]],
    }
  }
  return null
}
