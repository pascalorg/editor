import type { AnyNodeId, GutterNode, RoofSegmentNode, SceneApi } from '@pascal-app/core'

/**
 * Length-handle snap. When the user drags a gutter's ±X length handle
 * and the proposed endpoint lands within `SNAP_RADIUS` of the geometric
 * CORNER it would form with another gutter — the intersection of their
 * two length-axis lines — the dragged gutter's length is pulled so its
 * end lands exactly on that corner. The corner-mitre detector's match
 * window then fires reliably without a pixel-perfect drag.
 *
 * ONLY the dragged gutter moves. The corner is the axis crossing — a
 * fixed point in plan, independent of where the other gutter currently
 * ends — so each gutter snaps onto the SAME shared corner on its own as
 * it's dragged in, and the L meets there without ever reaching over to
 * reposition a gutter the user placed deliberately. (An earlier version
 * adjusted both gutters at once; that yanked an already-placed gutter
 * whenever its corner-mate was dragged, which is the bug this avoids.)
 *
 * Cross-segment: the search covers every gutter under the SAME ROOF
 * (not just the dragged gutter's segment-mates), and all the geometry
 * runs in the shared ROOF frame — each gutter's endpoints are lifted
 * out of its own segment-local frame by that segment's position +
 * Y-rotation. So an L-shaped plan whose two eaves live on different
 * roof segments snaps + mitres at the corner where the segments meet,
 * exactly like a same-segment hip corner (which is the degenerate case
 * where both gutters share one segment transform).
 *
 * Pure: no React, no THREE. Reads through SceneApi; returns the snapped
 * length for the caller to apply.
 */

// 10 cm catch radius — wide enough that the user doesn't need pixel-
// perfect dragging, narrow enough that unrelated gutters on the
// opposite eave don't accidentally bind.
const SNAP_RADIUS = 0.1
const SNAP_RADIUS_SQ = SNAP_RADIUS * SNAP_RADIUS

// Cross product below this counts as parallel axes — no intersection,
// fall back to snapping A onto B's current endpoint without modifying B.
const AXIS_PARALLEL_EPSILON = 1e-3

// How far a corner-mate's own nearer endpoint may sit from the corner
// and still bind the dragged gutter to it. The corner is the crossing
// of the two axis LINES, which can lie well beyond where a gutter ends —
// at an inner/concave corner the mate's end is a full eave overhang
// short of the crossing, so the bound has to clear a generous overhang.
// It also stops a far perpendicular gutter, whose infinite axis happens
// to cross near the dragged end, from binding by coincidence: a real
// corner-mate is within reach, an unrelated run is metres away.
const CORNER_MATE_REACH = 1.5
const CORNER_MATE_REACH_SQ = CORNER_MATE_REACH * CORNER_MATE_REACH

export type GutterLengthSnap = {
  /** Length to apply to the dragged gutter. */
  length: number
}

/**
 * @param initial          gutter at drag start (rotation, length, position)
 * @param proposedLength   length the linear-resize pipeline computed
 * @param sign             +1 for the gutter-local +X end being dragged, −1 for −X
 * @param anchorX,anchorZ  the held-fixed endpoint (opposite of `sign`)
 * @param armX,armZ        gutter +X direction in segment frame (cos r, −sin r)
 * @param minLength        floor — typically the descriptor's `min` value
 * @param sceneApi         scene access for corner-mate lookup
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

  // Everything runs in the ROOF frame so gutters on different segments
  // can meet. The dragged gutter's anchor/arm come in segment-local
  // (the caller computes them from `initial`); lift them into the roof
  // frame with the dragged segment's transform.
  const selfTf = segmentTransform(seg)
  const anchorR = applyTf(selfTf, anchorX, anchorZ)
  const armR = applyTfDir(selfTf, armX, armZ)
  const aAnchorX = anchorR.x
  const aAnchorZ = anchorR.z
  const aArmX = armR.x
  const aArmZ = armR.z

  const proposedEndX = aAnchorX + sign * proposedLength * aArmX
  const proposedEndZ = aAnchorZ + sign * proposedLength * aArmZ

  // Candidate gutters: every gutter under the SAME ROOF, each carrying
  // its own segment's roof-frame transform.
  type Cand = { gutter: GutterNode; tf: SegmentTransform }
  const candidates: Cand[] = []
  const roofId = seg.parentId as AnyNodeId | undefined
  const roof = roofId ? sceneApi.get(roofId) : undefined
  const roofChildren = (roof as { children?: readonly string[] } | undefined)?.children
  for (const sid of roofChildren ?? []) {
    const s = sceneApi.get<RoofSegmentNode>(sid as AnyNodeId)
    if (s?.type !== 'roof-segment') continue
    const tf = segmentTransform(s)
    for (const gid of s.children ?? []) {
      const g = sceneApi.get(gid as AnyNodeId)
      if (g?.type === 'gutter' && g.id !== initial.id) {
        candidates.push({ gutter: g as GutterNode, tf })
      }
    }
  }

  // Find the corner-mate whose CORNER with the dragged gutter lands
  // closest to the proposed dragged endpoint. The corner is the
  // intersection of the two length-axis LINES (roof frame) — NOT the
  // proximity of the two endpoints. That distinction is what unlocks
  // inner/concave corners: there the two eave drip-lines meet out in the
  // notch, a full overhang away from where either gutter naturally ends,
  // so the old endpoint-to-endpoint catch never fired. Keying off the
  // axis crossing treats convex and concave identically. Parallel axes
  // (a straight collinear run) have no crossing, so there we fall back to
  // the mate's nearer endpoint (flush join). Only the dragged gutter's
  // own length is snapped to the corner — the mate is never moved.
  let bestTargetX = 0
  let bestTargetZ = 0
  let bestDistSq = SNAP_RADIUS_SQ
  let found = false

  for (const { gutter: mateG, tf } of candidates) {
    const mateRot = mateG.rotation ?? 0
    const arm = applyTfDir(tf, Math.cos(mateRot), -Math.sin(mateRot))
    const mateHalf = mateG.length / 2
    const center = applyTf(tf, mateG.position[0], mateG.position[2])
    const plusX = center.x + arm.x * mateHalf
    const plusZ = center.z + arm.z * mateHalf
    const minusX = center.x - arm.x * mateHalf
    const minusZ = center.z - arm.z * mateHalf

    // Corner target T: axis intersection when the runs cross, else the
    // mate's endpoint nearest the dragged end (collinear extension).
    const crossDirs = aArmX * arm.z - aArmZ * arm.x
    let targetX: number
    let targetZ: number
    if (Math.abs(crossDirs) < AXIS_PARALLEL_EPSILON) {
      const dPlus = (plusX - proposedEndX) ** 2 + (plusZ - proposedEndZ) ** 2
      const dMinus = (minusX - proposedEndX) ** 2 + (minusZ - proposedEndZ) ** 2
      if (dPlus <= dMinus) {
        targetX = plusX
        targetZ = plusZ
      } else {
        targetX = minusX
        targetZ = minusZ
      }
    } else {
      const dx = center.x - aAnchorX
      const dz = center.z - aAnchorZ
      const t = (dx * arm.z - dz * arm.x) / crossDirs
      targetX = aAnchorX + t * aArmX
      targetZ = aAnchorZ + t * aArmZ
    }

    // Reject a mate whose own ends are nowhere near the crossing — its
    // infinite axis lines up by coincidence, it's not a real corner-mate.
    const dPlusT = (plusX - targetX) ** 2 + (plusZ - targetZ) ** 2
    const dMinusT = (minusX - targetX) ** 2 + (minusZ - targetZ) ** 2
    if (Math.min(dPlusT, dMinusT) > CORNER_MATE_REACH_SQ) continue

    const score = (targetX - proposedEndX) ** 2 + (targetZ - proposedEndZ) ** 2
    if (score < bestDistSq) {
      bestDistSq = score
      bestTargetX = targetX
      bestTargetZ = targetZ
      found = true
    }
  }

  if (!found) return { length: proposedLength }

  // Snap the dragged gutter's own end onto the corner: project
  // (corner − anchor) onto its roof-frame axis. Length is frame-invariant
  // (a scalar along the run), so the projection is the same in roof or
  // segment frame — no need to map back. The mate is left untouched.
  const projected = sign * ((bestTargetX - aAnchorX) * aArmX + (bestTargetZ - aAnchorZ) * aArmZ)
  return { length: Math.max(minLength, projected) }
}

// ─── Segment-frame ↔ roof-frame transform ────────────────────────────
//
// A segment places its children at `seg.position` rotated by
// `seg.rotation` about +Y. THREE's rotation-y convention: a point
// (x, z) maps to (x·cos + z·sin, −x·sin + z·cos). These helpers lift a
// gutter's segment-local X/Z into the shared roof frame and back so two
// gutters on different segments can be compared in one frame.

type SegmentTransform = { x: number; z: number; cos: number; sin: number }

function segmentTransform(seg: Pick<RoofSegmentNode, 'position' | 'rotation'>): SegmentTransform {
  const r = seg.rotation ?? 0
  return {
    x: seg.position?.[0] ?? 0,
    z: seg.position?.[2] ?? 0,
    cos: Math.cos(r),
    sin: Math.sin(r),
  }
}

function applyTf(tf: SegmentTransform, x: number, z: number): { x: number; z: number } {
  return { x: tf.x + (x * tf.cos + z * tf.sin), z: tf.z + (-x * tf.sin + z * tf.cos) }
}

function applyTfDir(tf: SegmentTransform, x: number, z: number): { x: number; z: number } {
  return { x: x * tf.cos + z * tf.sin, z: -x * tf.sin + z * tf.cos }
}
