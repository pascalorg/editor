import { formatAngleRadians } from '@pascal-app/core'
import { type ParseMeasurementOptions, parseMeasurement } from '../../../lib/measurement-parser'
import type { PlacementTypingValues } from '../../../store/use-placement-typing'
import type { WallPlanPoint } from './wall-drafting'

/**
 * Heading of a wall draft in degrees, the way the 15° angle snap measures it:
 * from the building's +X axis towards +Z (`atan2(dz, dx)`), in [0, 360).
 * On an unrotated plan +Z points down the screen, so 90 runs straight down.
 */
export function wallDraftHeadingDegrees(start: WallPlanPoint, end: WallPlanPoint): number | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  if (Math.hypot(dx, dz) <= 1e-6) return null
  const degrees = (Math.atan2(dz, dx) * 180) / Math.PI
  return ((degrees % 360) + 360) % 360
}

/** The draft's live heading as the angle field's placeholder, e.g. `90°`. */
export function formatWallDraftHeading(start: WallPlanPoint, end: WallPlanPoint): string {
  const degrees = wallDraftHeadingDegrees(start, end)
  if (degrees === null) return ''
  return formatAngleRadians(((Math.round(degrees) % 360) * Math.PI) / 180)
}

/**
 * The endpoint a typed wall draft commits to. Field 0 is the length, field 1
 * the heading (see `wallDraftHeadingDegrees`); an empty field is left to the
 * pointer:
 * - length only: the pointer steers the direction, the length is exact;
 * - angle only: the direction is locked, the pointer's projection onto it sets
 *   the length (quantised to `lengthStep` when one is given);
 * - both: the endpoint is fully determined and the pointer is ignored.
 *
 * Returns null when no field holds a usable value or the pointer gives no
 * direction to follow, so the caller keeps the pointer's own endpoint.
 */
export function resolveTypedWallEnd(
  start: WallPlanPoint,
  pointer: WallPlanPoint,
  fields: Readonly<PlacementTypingValues>,
  lengthOptions: ParseMeasurementOptions,
  lengthStep = 0,
): WallPlanPoint | null {
  const typedLength = fields[0].trim()
    ? parseMeasurement(fields[0], { kind: 'length', unitId: 'm' }, lengthOptions)
    : null
  const length = typedLength !== null && typedLength > 0 ? typedLength : null
  const typedAngle = fields[1].trim()
    ? parseMeasurement(fields[1], { kind: 'angle', unitId: 'rad' }, { bareUnit: 'deg' })
    : null

  const dx = pointer[0] - start[0]
  const dz = pointer[1] - start[1]
  if (typedAngle === null) {
    if (length === null) return null
    const pointerLength = Math.hypot(dx, dz)
    if (pointerLength <= 1e-6) return null
    return [start[0] + (dx / pointerLength) * length, start[1] + (dz / pointerLength) * length]
  }

  const dirX = Math.cos(typedAngle)
  const dirZ = Math.sin(typedAngle)
  let distance = length
  if (distance === null) {
    const projected = Math.max(0, dx * dirX + dz * dirZ)
    distance = lengthStep > 0 ? Math.round(projected / lengthStep) * lengthStep : projected
  }
  return [start[0] + dirX * distance, start[1] + dirZ * distance]
}
