import { snapScalar } from '@pascal-app/core'

export function resolveResizeSnapValue({
  rawValue,
  gridSnapEnabled,
  gridSnapActive,
  gridSnapStep,
  magneticSnapActive,
  magneticSnap,
}: {
  rawValue: number
  gridSnapEnabled: boolean
  gridSnapActive: boolean
  gridSnapStep: number
  magneticSnapActive: boolean
  magneticSnap?: (value: number) => number
}): number {
  const gridValue =
    gridSnapEnabled && gridSnapActive && gridSnapStep > 0
      ? snapScalar(rawValue, gridSnapStep)
      : rawValue
  return magneticSnapActive && magneticSnap ? magneticSnap(gridValue) : gridValue
}
