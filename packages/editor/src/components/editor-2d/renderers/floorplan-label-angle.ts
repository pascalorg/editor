export function resolveFloorplanLabelAngle(
  angleRadians: number,
  sceneRotationDeg: number,
  screenUpright = false,
): number {
  if (screenUpright) return -sceneRotationDeg

  let localAngleDeg = (angleRadians * 180) / Math.PI
  let screenAngleDeg = localAngleDeg + sceneRotationDeg
  screenAngleDeg = ((((screenAngleDeg + 180) % 360) + 360) % 360) - 180
  if (screenAngleDeg > 90) localAngleDeg -= 180
  else if (screenAngleDeg <= -90) localAngleDeg += 180
  return ((((localAngleDeg + 180) % 360) + 360) % 360) - 180
}
