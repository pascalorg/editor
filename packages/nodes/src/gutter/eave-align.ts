import type { GutterNode, RoofSegmentNode } from '@pascal-app/core'
import { CORNER_EPSILON_SQ, gutterEndpointsInFrame, planDistSq } from './corner-mitre'
import { computeEaveY } from './eave-snap'

/**
 * Shared eave-Y for a connected run of gutters.
 *
 * Each gutter normally derives its mount height independently from its
 * own host segment via `computeEaveY` (wallHeight − overhang·tan(pitch)
 * + tuck, or wallHeight on a flat deck). Two segments that read as the
 * same height in the inspector can still land at different eave Ys when
 * their pitch / overhang / roofType differ — so gutters that meet at a
 * corner inherit two heights and the run visibly steps at the joint.
 *
 * This walks the connected component of gutters that meet at corners
 * (same plan-space endpoint test the mitre detector uses — Y is
 * deliberately ignored, so the grouping survives the very height drift
 * we're correcting) and returns ONE height for the whole run: the
 * HIGHEST member eave. Aligning up means no gutter ever sinks into a
 * roof surface; a lower roof gets a small fascia gap, which reads
 * cleaner than a gutter clipping through its slope.
 *
 * Deterministic + symmetric: every gutter in the run computes the same
 * component and the same max, so they all converge on the identical Y
 * without any shared coordinator or store write. Isolated gutters (no
 * corner neighbour) get their own eave Y unchanged.
 *
 * Pure: no React, no scene access, no store mutation.
 */

/** A sibling gutter paired with its FULL host segment (needs the eave-Y inputs). */
export type GutterWithSegment = {
  gutter: GutterNode
  segment: RoofSegmentNode
}

function guttersMeet(
  a: GutterNode,
  aSeg: RoofSegmentNode,
  b: GutterNode,
  bSeg: RoofSegmentNode,
): boolean {
  const ea = gutterEndpointsInFrame(a, aSeg)
  const eb = gutterEndpointsInFrame(b, bSeg)
  return (
    planDistSq(ea.minus.pos, eb.plus.pos) <= CORNER_EPSILON_SQ ||
    planDistSq(ea.minus.pos, eb.minus.pos) <= CORNER_EPSILON_SQ ||
    planDistSq(ea.plus.pos, eb.plus.pos) <= CORNER_EPSILON_SQ ||
    planDistSq(ea.plus.pos, eb.minus.pos) <= CORNER_EPSILON_SQ
  )
}

// Each gutter mounts at `segment.position[1] + computeEaveY(segment)` in
// the roof frame (the renderer adds the segment-local eave Y under the
// segment's group). Segments can sit at different Y offsets, so the run
// has to be compared — and the answer returned — in the SHARED roof
// frame, not raw segment-local eave Ys.
function worldEaveY(segment: RoofSegmentNode): number {
  return (segment.position?.[1] ?? 0) + computeEaveY(segment)
}

export function computeSharedEaveY(
  subject: GutterNode,
  subjectSegment: RoofSegmentNode,
  siblings: readonly GutterWithSegment[],
): number {
  const subjectBaseY = subjectSegment.position?.[1] ?? 0
  if (siblings.length === 0) return computeEaveY(subjectSegment)

  // Index 0 is the subject; the rest are candidates. BFS the corner
  // graph from the subject and keep the tallest eave in its component.
  const nodes: GutterWithSegment[] = [{ gutter: subject, segment: subjectSegment }, ...siblings]
  const visited = new Array<boolean>(nodes.length).fill(false)
  visited[0] = true
  const queue = [0]
  let maxWorldEaveY = worldEaveY(subjectSegment)

  while (queue.length > 0) {
    const i = queue.pop()!
    const cur = nodes[i]!
    for (let j = 0; j < nodes.length; j++) {
      if (visited[j]) continue
      const other = nodes[j]!
      if (guttersMeet(cur.gutter, cur.segment, other.gutter, other.segment)) {
        visited[j] = true
        queue.push(j)
        const eaveY = worldEaveY(other.segment)
        if (eaveY > maxWorldEaveY) maxWorldEaveY = eaveY
      }
    }
  }

  // Back to the SUBJECT's segment-local frame — the renderer applies the
  // returned value under the subject segment's group, which already adds
  // `subjectBaseY`.
  return maxWorldEaveY - subjectBaseY
}
