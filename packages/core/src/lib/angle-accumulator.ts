/** Unwrap consecutive pointer bearings into a continuous gesture angle. */
export function createAngleAccumulator(initialAngle: number) {
  let previous = initialAngle
  let total = 0
  return (angle: number) => {
    if (!Number.isFinite(angle)) return total
    const change = angle - previous
    total += Math.atan2(Math.sin(change), Math.cos(change))
    previous = angle
    return total
  }
}
