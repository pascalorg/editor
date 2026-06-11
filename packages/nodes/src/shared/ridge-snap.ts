import type { RoofSegmentNode } from '@pascal-app/core'

/**
 * Shared ridge-line snap math for ridge-vent placement + move tools.
 *
 * Ridge vents must sit centered on the segment's ridge — off-ridge the
 * cap's far half dips into the higher part of the slope ("goes inside"
 * the roof). So the placement tools clamp the cursor onto the ridge:
 * closest-point projection along the segment's local X axis, with the X
 * span clipped to where a real ridge actually exists for that roof type.
 *
 * Per roof type (the segment's ridge runs along the segment's local X):
 *   - gable / gambrel / dutch / mansard: ridge spans the full width.
 *   - hip: ridge is shortened by the hipped ends — spans width − depth.
 *     A square hip (width ≤ depth) collapses to a single apex point.
 *   - shed: no true ridge — snap to the high eave (z = -depth/2).
 *   - flat: no ridge at all → return null.
 */

// Standard lift above the analytical slope surface so the cap reads as
// sitting on the shingle course rather than clipping into it. Shared
// with the renderer so live ridge-Y derivation matches placement.
export const RIDGE_LIFT = 0.12

export type RidgeSnap = {
  /** Segment-local X of the snapped ridge position. */
  localX: number
  /** Segment-local Z of the snapped ridge position (0 for peaked roofs). */
  localZ: number
}

export function resolveRidgeSnap(
  segment: RoofSegmentNode,
  cursorLocalX: number,
  _cursorLocalZ: number,
): RidgeSnap | null {
  const roofType = segment.roofType ?? 'gable'
  if (roofType === 'flat') return null

  const halfW = (segment.width ?? 0) / 2
  const halfD = (segment.depth ?? 0) / 2

  const ridgeZ = roofType === 'shed' ? -halfD : 0
  const ridgeHalfLength = roofType === 'hip' ? Math.max(0, halfW - halfD) : halfW
  const localX = Math.max(-ridgeHalfLength, Math.min(ridgeHalfLength, cursorLocalX))

  return { localX, localZ: ridgeZ }
}
