import type { FenceNode, WallNode } from '@pascal-app/core'
import {
  type FencePlanPoint,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
} from '@pascal-app/editor'

/**
 * Pure angle-pill picker for the beam endpoint drag. Finds the first beam
 * endpoint (start or end) that meets a neighbouring segment — a wall, a
 * fence, or a linked beam sharing the junction — and returns the angle
 * between them plus the pill's world position.
 *
 * The dragged beam itself is never in `segments`, so every candidate is a
 * genuine neighbour. React-free so the junction logic is unit-testable.
 */

export type BeamAngleSegment = {
  id: string
  start: FencePlanPoint
  end: FencePlanPoint
  curveOffset?: number
}

export function referenceSegments(walls: WallNode[], fences: FenceNode[]): BeamAngleSegment[] {
  return [
    ...walls.map((w) => ({ id: w.id, start: w.start, end: w.end, curveOffset: w.curveOffset })),
    ...fences.map((f) => ({ id: f.id, start: f.start, end: f.end, curveOffset: f.curveOffset })),
  ]
}

export function pickBeamAngleLabel(args: {
  start: FencePlanPoint
  end: FencePlanPoint
  segments: BeamAngleSegment[]
}): { label: string; position: [number, number, number] } | null {
  const target: BeamAngleSegment = { id: 'beam', start: args.start, end: args.end }
  for (const endpoint of [args.start, args.end] as FencePlanPoint[]) {
    const targetRef = getSegmentAngleReferenceAtPoint(endpoint, target)
    if (!targetRef) continue
    const neighbour = args.segments.find((s) =>
      Boolean(getSegmentAngleReferenceAtPoint(endpoint, s)),
    )
    if (!neighbour) continue
    const neighbourRef = getSegmentAngleReferenceAtPoint(endpoint, neighbour)
    if (!neighbourRef) continue
    const angle = getAngleToSegmentReference(targetRef.vector, neighbourRef)
    if (angle === null) continue
    return {
      label: formatAngleRadians(angle),
      position: [endpoint[0], 0.34, endpoint[1]],
    }
  }
  return null
}
