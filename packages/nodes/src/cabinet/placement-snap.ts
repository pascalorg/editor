export function snapCabinetFootprintCenter(value: number, extent: number, step: number): number {
  if (step <= 0) return value
  const halfExtent = extent / 2
  const offset = ((halfExtent % step) + step) % step
  return Math.round((value - offset) / step) * step + offset
}

export function resolveCabinetGridPosition({
  raw,
  dimensions,
  footprintOffset = [0, 0],
  yaw,
  step,
}: {
  raw: [number, number, number]
  dimensions: [number, number, number]
  footprintOffset?: [number, number]
  yaw: number
  step: number
}): [number, number, number] {
  if (step <= 0) return [raw[0], 0, raw[2]]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const footprintCenterX = raw[0] + footprintOffset[0] * cos + footprintOffset[1] * sin
  const footprintCenterZ = raw[2] - footprintOffset[0] * sin + footprintOffset[1] * cos
  const extentX = Math.abs(cos) * dimensions[0] + Math.abs(sin) * dimensions[2]
  const extentZ = Math.abs(sin) * dimensions[0] + Math.abs(cos) * dimensions[2]
  const snappedCenterX = snapCabinetFootprintCenter(footprintCenterX, extentX, step)
  const snappedCenterZ = snapCabinetFootprintCenter(footprintCenterZ, extentZ, step)

  return [
    snappedCenterX - footprintOffset[0] * cos - footprintOffset[1] * sin,
    0,
    snappedCenterZ + footprintOffset[0] * sin - footprintOffset[1] * cos,
  ]
}

export function resolveCabinetGridPositionInFrame({
  raw,
  dimensions,
  footprintOffset = [0, 0],
  yaw,
  step,
  frame,
}: {
  raw: [number, number, number]
  dimensions: [number, number, number]
  footprintOffset?: [number, number]
  yaw: number
  step: number
  frame: { position: [number, number]; rotationY: number }
}): [number, number, number] {
  if (step <= 0) return [raw[0], 0, raw[2]]

  const frameCos = Math.cos(frame.rotationY)
  const frameSin = Math.sin(frame.rotationY)
  const worldX = frame.position[0] + raw[0] * frameCos + raw[2] * frameSin
  const worldZ = frame.position[1] - raw[0] * frameSin + raw[2] * frameCos
  const worldYaw = frame.rotationY + yaw
  const yawCos = Math.cos(worldYaw)
  const yawSin = Math.sin(worldYaw)
  const footprintCenterX = worldX + footprintOffset[0] * yawCos + footprintOffset[1] * yawSin
  const footprintCenterZ = worldZ - footprintOffset[0] * yawSin + footprintOffset[1] * yawCos
  const extentX = Math.abs(yawCos) * dimensions[0] + Math.abs(yawSin) * dimensions[2]
  const extentZ = Math.abs(yawSin) * dimensions[0] + Math.abs(yawCos) * dimensions[2]
  const snappedCenterX = snapCabinetFootprintCenter(footprintCenterX, extentX, step)
  const snappedCenterZ = snapCabinetFootprintCenter(footprintCenterZ, extentZ, step)
  const snappedWorldX = snappedCenterX - footprintOffset[0] * yawCos - footprintOffset[1] * yawSin
  const snappedWorldZ = snappedCenterZ + footprintOffset[0] * yawSin - footprintOffset[1] * yawCos

  return [
    (snappedWorldX - frame.position[0]) * frameCos - (snappedWorldZ - frame.position[1]) * frameSin,
    0,
    (snappedWorldX - frame.position[0]) * frameSin + (snappedWorldZ - frame.position[1]) * frameCos,
  ]
}
