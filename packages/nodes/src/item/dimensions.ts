export const MIN_ITEM_SCALE = 0.01

export type DimensionAxis = 0 | 1 | 2
export type Vec3Tuple = [number, number, number]

export function isValidAssetDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Returns the subset of axes (`0 = width`, `1 = height`, `2 = depth`) that have
 * a positive, finite base dimension on `asset.dimensions`.
 */
export function editableDimensionAxes(
  dimensions: readonly number[] | undefined | null,
): DimensionAxis[] {
  if (!Array.isArray(dimensions) || dimensions.length < 3) return []
  const axes: DimensionAxis[] = []
  for (const axis of [0, 1, 2] as const) {
    if (isValidAssetDimension(dimensions[axis])) axes.push(axis)
  }
  return axes
}

/**
 * Computes the next `ItemNode.scale` when editing physical dimension `axis` to
 * `requestedDimension` (in meters).
 *
 * - Returns `null` if `assetDimensions[axis]` is missing, zero, negative, or
 *   non-finite, or if `requestedDimension` is not a positive finite number.
 * - When `uniform` is `false`, updates only `axis` to `requested / baseDim`.
 * - When `uniform` is `true`, scales all three axes by the same factor so the
 *   item keeps its aspect ratio (for uniformly scaled items this sets all three
 *   axes to `requested / baseDim`).
 * - Preserves each axis sign (for mirrored items) and clamps magnitudes to at
 *   least `MIN_ITEM_SCALE`.
 */
export function computeScaleForDimension(
  assetDimensions: readonly number[] | undefined | null,
  currentScale: readonly [number, number, number],
  axis: DimensionAxis,
  requestedDimension: number,
  uniform: boolean,
): Vec3Tuple | null {
  if (!Array.isArray(assetDimensions) || assetDimensions.length < 3) return null
  const baseDim = assetDimensions[axis]
  if (!isValidAssetDimension(baseDim)) return null
  if (!Number.isFinite(requestedDimension) || requestedDimension <= 0) return null

  const nextAxisMagnitude = Math.max(MIN_ITEM_SCALE, requestedDimension / baseDim)
  const axisSign = currentScale[axis] < 0 ? -1 : 1

  if (!uniform) {
    const next: Vec3Tuple = [currentScale[0], currentScale[1], currentScale[2]]
    next[axis] = axisSign * nextAxisMagnitude
    return next
  }

  const magnitudes: Vec3Tuple = [
    Math.abs(currentScale[0]),
    Math.abs(currentScale[1]),
    Math.abs(currentScale[2]),
  ]
  const currentAxisMagnitude = magnitudes[axis]
  if (!Number.isFinite(currentAxisMagnitude) || currentAxisMagnitude <= 0) {
    return [
      (currentScale[0] < 0 ? -1 : 1) * nextAxisMagnitude,
      (currentScale[1] < 0 ? -1 : 1) * nextAxisMagnitude,
      (currentScale[2] < 0 ? -1 : 1) * nextAxisMagnitude,
    ]
  }

  const isUniformCurrent = magnitudes[0] === magnitudes[1] && magnitudes[1] === magnitudes[2]
  if (isUniformCurrent) {
    return [
      (currentScale[0] < 0 ? -1 : 1) * nextAxisMagnitude,
      (currentScale[1] < 0 ? -1 : 1) * nextAxisMagnitude,
      (currentScale[2] < 0 ? -1 : 1) * nextAxisMagnitude,
    ]
  }

  const factor = nextAxisMagnitude / currentAxisMagnitude
  const next: Vec3Tuple = [
    (currentScale[0] < 0 ? -1 : 1) * Math.max(MIN_ITEM_SCALE, magnitudes[0] * factor),
    (currentScale[1] < 0 ? -1 : 1) * Math.max(MIN_ITEM_SCALE, magnitudes[1] * factor),
    (currentScale[2] < 0 ? -1 : 1) * Math.max(MIN_ITEM_SCALE, magnitudes[2] * factor),
  ]
  next[axis] = axisSign * nextAxisMagnitude
  return next
}
