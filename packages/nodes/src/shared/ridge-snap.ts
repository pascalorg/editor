import {
  getRoofSegmentVisibleTopBounds,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
} from '@pascal-app/core'

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
 *   - gable / gambrel: ridge spans the full width.
 *   - mansard: ridge is shortened to the upper hip roof.
 *   - dutch: ridge is shortened by the hipped shoulders.
 *   - hip: ridge is shortened by the hipped ends — spans width − depth.
 *     A square hip (width ≤ depth) collapses to a single apex point.
 *   - shed: no true ridge — snap to the high eave (z = -depth/2).
 *   - flat: no ridge at all → return null.
 */

// Ridge vents seat directly onto the analytical roof surface; any visible
// thickness belongs in the vent geometry itself, not in a renderer lift.
export const RIDGE_LIFT = 0

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

  const { width, depth, minX, maxX, minZ, maxZ } = getRoofSegmentVisibleTopBounds(segment)
  const halfD = depth / 2

  const ridgeZ = roofType === 'shed' ? minZ : 0
  if (roofType !== 'shed' && (minZ > 0 || maxZ < 0)) return null
  const mansardInset =
    Math.min(width, depth) *
    (segment.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio)
  const dutchInset =
    Math.min(width, depth) * (segment.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio)
  let ridgeMinX = minX
  let ridgeMaxX = maxX

  if (roofType === 'hip') {
    ridgeMinX = minX + halfD
    ridgeMaxX = maxX - halfD
  } else if (roofType === 'mansard') {
    const shoulderMinX = minX + mansardInset
    const shoulderMaxX = maxX - mansardInset
    const topD = Math.max(0, maxZ - minZ - mansardInset * 2)
    ridgeMinX = shoulderMinX + topD / 2
    ridgeMaxX = shoulderMaxX - topD / 2
  } else if (roofType === 'dutch') {
    ridgeMinX = minX + dutchInset
    ridgeMaxX = maxX - dutchInset
  }

  if (ridgeMinX > ridgeMaxX) {
    const apexX = (ridgeMinX + ridgeMaxX) / 2
    return { localX: apexX, localZ: ridgeZ }
  }

  const localX = Math.max(ridgeMinX, Math.min(ridgeMaxX, cursorLocalX))

  return { localX, localZ: ridgeZ }
}
