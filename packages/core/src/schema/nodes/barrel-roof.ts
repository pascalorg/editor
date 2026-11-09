/** Circular segment from the back eave to the front eave. Rise never exceeds a semicircle. */
export function getBarrelRoofProfile(
  span: number,
  requestedRise: number,
  segments = 12,
): [number, number][] {
  const half = Math.max(0.005, span / 2)
  const rise = Math.max(0.0001, Math.min(half, requestedRise))
  const radius = (half * half + rise * rise) / (2 * rise)
  const angle = 2 * Math.atan(rise / half)
  return Array.from({ length: segments + 1 }, (_, i) => {
    const theta = -angle + (2 * angle * i) / segments
    return [radius * Math.sin(theta), rise - radius + radius * Math.cos(theta)]
  })
}
