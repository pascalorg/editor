import { type ParseMeasurementOptions, parseMeasurement } from '../../../lib/measurement-parser'
import type { PlacementTypingValues } from '../../../store/use-placement-typing'
import type { WallPlanPoint } from './wall-drafting'

/**
 * The endpoint a typed wall draft commits to: field 0 is the length, and the
 * pointer steers the direction. Returns null when the field holds no usable
 * length or the pointer gives no direction to follow, so the caller keeps the
 * pointer's own endpoint.
 */
export function resolveTypedWallEnd(
  start: WallPlanPoint,
  pointer: WallPlanPoint,
  fields: Readonly<PlacementTypingValues>,
  lengthOptions: ParseMeasurementOptions,
): WallPlanPoint | null {
  const typedLength = fields[0].trim()
    ? parseMeasurement(fields[0], { kind: 'length', unitId: 'm' }, lengthOptions)
    : null
  if (typedLength === null || typedLength <= 0) return null
  const dx = pointer[0] - start[0]
  const dz = pointer[1] - start[1]
  const pointerLength = Math.hypot(dx, dz)
  if (pointerLength <= 1e-6) return null
  return [
    start[0] + (dx / pointerLength) * typedLength,
    start[1] + (dz / pointerLength) * typedLength,
  ]
}
