import type { AnyNodeId, GutterNode, RoofSegmentNode, SceneApi } from '@pascal-app/core'

/**
 * Length-handle snap. When the user drags a gutter's ±X length handle
 * and the proposed endpoint lands within `SNAP_RADIUS` of a sibling
 * gutter's endpoint (in segment-local space), pull BOTH gutters'
 * lengths so they meet at the geometric corner — the intersection of
 * their length-axis lines. The corner-mitre detector's 5 cm match
 * window then fires reliably without asking the user to land a
 * pixel-perfect drag.
 *
 * Both-sides adjustment is the point: snapping A to wherever B
 * currently sits glues the L to B's possibly-imprecise position, but
 * the intersection point IS the eave corner (each eave-snapped gutter
 * runs along its eave line, so the axis crossing is the eave corner
 * in plan). Adjusting B too makes the L "click into" the eave
 * intersection no matter which side the user dragged.
 *
 * Stable-state guard: when the snap is sustained across drag ticks the
 * sibling's length / position won't visibly change from one tick to
 * the next. We skip the sibling update in that case so we're not
 * thrashing the store ~60×/sec for no visual change.
 *
 * Pure: no React, no THREE. Reads through SceneApi; writes are
 * returned as a sibling adjustment for the caller to apply (so the
 * caller decides when to commit).
 */

// 10 cm catch radius — wide enough that the user doesn't need pixel-
// perfect dragging, narrow enough that unrelated gutters on the
// opposite eave don't accidentally bind.
const SNAP_RADIUS = 0.1
const SNAP_RADIUS_SQ = SNAP_RADIUS * SNAP_RADIUS

// Cross product below this counts as parallel axes — no intersection,
// fall back to snapping A onto B's current endpoint without modifying B.
const AXIS_PARALLEL_EPSILON = 1e-3

// Sibling update threshold: ~1 mm of change. Below this we treat the
// snap as "already at target" and skip the store write.
const STABLE_EPSILON = 1e-3

export type GutterLengthSnap = {
  /** Length to apply to the dragged gutter. */
  length: number
  /**
   * When set, the named sibling needs to be re-lengthened so its
   * matching endpoint meets the dragged gutter at the same corner.
   * Caller writes via `sceneApi.update`; history is paused during the
   * drag so it batches with the main commit at pointer-up.
   */
  sibling?: {
    id: AnyNodeId
    length: number
    position: [number, number, number]
  }
}

/**
 * @param initial          gutter at drag start (rotation, length, position)
 * @param proposedLength   length the linear-resize pipeline computed
 * @param sign             +1 for the gutter-local +X end being dragged, −1 for −X
 * @param anchorX,anchorZ  the held-fixed endpoint (opposite of `sign`)
 * @param armX,armZ        gutter +X direction in segment frame (cos r, −sin r)
 * @param minLength        floor — typically the descriptor's `min` value
 * @param sceneApi         scene access for sibling lookup
 */
export function snapLengthToCorner(
  initial: GutterNode,
  proposedLength: number,
  sign: 1 | -1,
  anchorX: number,
  anchorZ: number,
  armX: number,
  armZ: number,
  minLength: number,
  sceneApi: SceneApi,
): GutterLengthSnap {
  const segmentId = initial.roofSegmentId as AnyNodeId | undefined
  if (!segmentId) return { length: proposedLength }
  const seg = sceneApi.get<RoofSegmentNode>(segmentId)
  if (!seg) return { length: proposedLength }

  const proposedEndX = anchorX + sign * proposedLength * armX
  const proposedEndZ = anchorZ + sign * proposedLength * armZ

  // Pass 1: pick the sibling whose endpoint is closest to the proposed
  // end, and remember WHICH end (+X or −X) we matched on.
  let bestSib: GutterNode | null = null
  let bestSibEndIsPlus = false
  let bestSibEndX = 0
  let bestSibEndZ = 0
  let bestDistSq = SNAP_RADIUS_SQ

  for (const sibId of seg.children ?? []) {
    const sib = sceneApi.get(sibId as AnyNodeId)
    if (!sib || sib.type !== 'gutter' || sib.id === initial.id) continue
    const sibG = sib as GutterNode
    const sibRot = sibG.rotation ?? 0
    const sibArmX = Math.cos(sibRot)
    const sibArmZ = -Math.sin(sibRot)
    const sibHalf = sibG.length / 2
    const plusX = sibG.position[0] + sibArmX * sibHalf
    const plusZ = sibG.position[2] + sibArmZ * sibHalf
    const minusX = sibG.position[0] - sibArmX * sibHalf
    const minusZ = sibG.position[2] - sibArmZ * sibHalf

    const dPlusSq = (plusX - proposedEndX) ** 2 + (plusZ - proposedEndZ) ** 2
    if (dPlusSq < bestDistSq) {
      bestDistSq = dPlusSq
      bestSib = sibG
      bestSibEndIsPlus = true
      bestSibEndX = plusX
      bestSibEndZ = plusZ
    }
    const dMinusSq = (minusX - proposedEndX) ** 2 + (minusZ - proposedEndZ) ** 2
    if (dMinusSq < bestDistSq) {
      bestDistSq = dMinusSq
      bestSib = sibG
      bestSibEndIsPlus = false
      bestSibEndX = minusX
      bestSibEndZ = minusZ
    }
  }

  if (!bestSib) return { length: proposedLength }

  // Pass 2: find the geometric corner — intersection of A's axis and
  // B's axis. For two eave-snapped gutters this IS the eave corner.
  // Fall back to B's endpoint if the axes are parallel (rare; means
  // both gutters point the same way and there's no real corner).
  const sibRot = bestSib.rotation ?? 0
  const sibArmX = Math.cos(sibRot)
  const sibArmZ = -Math.sin(sibRot)
  const sibPosX = bestSib.position[0]
  const sibPosZ = bestSib.position[2]

  const crossDirs = armX * sibArmZ - armZ * sibArmX
  let targetX: number
  let targetZ: number

  if (Math.abs(crossDirs) < AXIS_PARALLEL_EPSILON) {
    targetX = bestSibEndX
    targetZ = bestSibEndZ
  } else {
    // (sibPos − anchor) = t·d_A − s·d_B  →  t = cross(sibPos − anchor, d_B) / cross(d_A, d_B)
    const dx = sibPosX - anchorX
    const dz = sibPosZ - anchorZ
    const t = (dx * sibArmZ - dz * sibArmX) / crossDirs
    targetX = anchorX + t * armX
    targetZ = anchorZ + t * armZ

    // Reject far-off intersections — if the axes cross out beyond the
    // snap radius (e.g. user is mid-drag and only briefly clipped the
    // sibling endpoint), don't yank the gutter across the roof.
    const distSqFromProposed =
      (targetX - proposedEndX) ** 2 + (targetZ - proposedEndZ) ** 2
    if (distSqFromProposed > SNAP_RADIUS_SQ) {
      targetX = bestSibEndX
      targetZ = bestSibEndZ
    }
  }

  // Snap A: project (target − anchor) onto A's axis direction. `sign`
  // flips so the projection produces a positive length when the target
  // sits on the dragged side of the anchor.
  const projectedA = sign * ((targetX - anchorX) * armX + (targetZ - anchorZ) * armZ)
  const snappedLength = Math.max(minLength, projectedA)

  // Snap B: the END that matched moves to the target; the OPPOSITE end
  // stays fixed (B's anchor). Same asymmetric-resize math as A's apply
  // — anchor + (sign · newLen) · arm gives the moving end at the
  // target; new center sits at the midpoint.
  const sibHalf = bestSib.length / 2
  const sibAnchorSign = bestSibEndIsPlus ? -1 : 1 // opposite end stays put
  const sibAnchorX = sibPosX + sibAnchorSign * sibArmX * sibHalf
  const sibAnchorZ = sibPosZ + sibAnchorSign * sibArmZ * sibHalf

  const sibMovingSign = bestSibEndIsPlus ? 1 : -1
  const sibProjected =
    sibMovingSign * ((targetX - sibAnchorX) * sibArmX + (targetZ - sibAnchorZ) * sibArmZ)
  const sibNewLength = Math.max(minLength, sibProjected)
  const sibNewCenterX = sibAnchorX + sibMovingSign * (sibNewLength / 2) * sibArmX
  const sibNewCenterZ = sibAnchorZ + sibMovingSign * (sibNewLength / 2) * sibArmZ

  const lengthDelta = Math.abs(sibNewLength - bestSib.length)
  const posDelta = Math.abs(sibNewCenterX - sibPosX) + Math.abs(sibNewCenterZ - sibPosZ)
  if (lengthDelta < STABLE_EPSILON && posDelta < STABLE_EPSILON) {
    return { length: snappedLength }
  }

  return {
    length: snappedLength,
    sibling: {
      id: bestSib.id as AnyNodeId,
      length: sibNewLength,
      position: [sibNewCenterX, bestSib.position[1], sibNewCenterZ],
    },
  }
}
