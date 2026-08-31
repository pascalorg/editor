export function snapCabinetFootprintCenter(value: number, extent: number, step: number): number {
  if (step <= 0) return value
  const halfExtent = extent / 2
  const offset = ((halfExtent % step) + step) % step
  return Math.round((value - offset) / step) * step + offset
}

export function resolveCabinetGridPosition({
  raw,
  dimensions,
  yaw,
  step,
}: {
  raw: [number, number, number]
  dimensions: [number, number, number]
  yaw: number
  step: number
}): [number, number, number] {
  if (step <= 0) return [raw[0], 0, raw[2]]
  const swapAxes = Math.abs(Math.sin(yaw)) > 0.9
  const extentX = swapAxes ? dimensions[2] : dimensions[0]
  const extentZ = swapAxes ? dimensions[0] : dimensions[2]

  return [
    snapCabinetFootprintCenter(raw[0], extentX, step),
    0,
    snapCabinetFootprintCenter(raw[2], extentZ, step),
  ]
}
