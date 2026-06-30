import {
  getRidgeVentLinesForSegment,
  getRoofSegmentVisibleTopBounds,
  type RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Shared ridge-line snap math for ridge-vent placement + move tools.
 *
 * Ridge vents must sit centered on a roof break line — off-line the cap's
 * far half dips into the higher part of the slope ("goes inside" the roof).
 * So the placement tools clamp the cursor onto the nearest generated ridge
 * line, preserving the line's yaw for hip / lower-slope runs.
 *
 * Per roof type:
 *   - gable / gambrel: ridge spans the full width.
 *   - mansard: top ridge, upper hip runs, plus lower-slope runs on all
 *     four steep lower faces.
 *   - dutch: top ridge between the gablet waists plus four hip runs down
 *     to the eave corners (the gablet ends are vertical walls, not ridges).
 *   - hip: ridge is shortened by the hipped ends — spans width − depth.
 *     A square hip (width ≤ depth) collapses to a single apex point.
 *   - shed: no true ridge — snap to the high eave (z = -depth/2).
 *   - flat: no ridge at all → return null.
 */

// Ridge vents seat directly onto the analytical roof surface; any visible
// thickness belongs in the vent geometry itself, not in a renderer lift.
export const RIDGE_LIFT = 0.09

export type RidgeSnap = {
  /** Segment-local X of the snapped ridge position. */
  localX: number
  /** Segment-local Z of the snapped ridge position. */
  localZ: number
  /** Segment-local yaw matching the snapped ridge line. */
  rotation: number
}

export function resolveRidgeSnap(
  segment: RoofSegmentNode,
  cursorLocalX: number,
  cursorLocalZ: number,
): RidgeSnap | null {
  const roofType = segment.roofType ?? 'gable'
  if (roofType === 'flat') return null

  const lines =
    roofType === 'shed'
      ? getShedHighEaveLine(segment)
      : getRidgeVentLinesForSegment(segment).map(({ start, end }) => ({ start, end }))
  if (lines.length === 0) return null

  let best: RidgeSnap | null = null
  let bestDistanceSq = Number.POSITIVE_INFINITY

  for (const line of lines) {
    const [sx, sz] = line.start
    const [ex, ez] = line.end
    const dx = ex - sx
    const dz = ez - sz
    const lengthSq = dx * dx + dz * dz
    const t =
      lengthSq <= 1e-8
        ? 0
        : Math.max(0, Math.min(1, ((cursorLocalX - sx) * dx + (cursorLocalZ - sz) * dz) / lengthSq))
    const localX = sx + dx * t
    const localZ = sz + dz * t
    const distanceSq = (cursorLocalX - localX) ** 2 + (cursorLocalZ - localZ) ** 2

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      best = {
        localX,
        localZ,
        rotation: Math.atan2(-dz, dx),
      }
    }
  }

  return best
}

function getShedHighEaveLine(segment: RoofSegmentNode) {
  const { minX, maxX, minZ } = getRoofSegmentVisibleTopBounds(segment)
  return [{ start: [minX, minZ] as [number, number], end: [maxX, minZ] as [number, number] }]
}
