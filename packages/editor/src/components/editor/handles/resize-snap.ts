import { snapScalar } from '@pascal-app/core'

export function resolveResizeSnapValue({
  rawValue,
  fallbackValue = rawValue,
  gridSnapEnabled,
  gridSnapActive,
  gridSnapStep,
  magneticSnapActive,
  magneticSnap,
}: {
  rawValue: number
  fallbackValue?: number
  gridSnapEnabled: boolean
  gridSnapActive: boolean
  gridSnapStep: number
  magneticSnapActive: boolean
  magneticSnap?: (value: number) => number
}): number {
  if (!Number.isFinite(rawValue)) return fallbackValue
  const gridValue =
    gridSnapEnabled && gridSnapActive && gridSnapStep > 0
      ? snapScalar(rawValue, gridSnapStep)
      : rawValue
  const resolved = magneticSnapActive && magneticSnap ? magneticSnap(gridValue) : gridValue
  return Number.isFinite(resolved) ? resolved : fallbackValue
}
