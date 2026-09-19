export const COMFORT_REFERENCE_SPEED = 1.5
export const MAX_COMFORT_OPACITY = 0.22

export function resolveComfortOpacity(speed: number, referenceSpeed = COMFORT_REFERENCE_SPEED) {
  if (!Number.isFinite(speed) || !Number.isFinite(referenceSpeed) || referenceSpeed <= 0) return 0
  return MAX_COMFORT_OPACITY * Math.min(1, Math.abs(speed) / referenceSpeed)
}
