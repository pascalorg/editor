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

  const snapEdge = (value: number, extent: number) => {
    const halfExtent = extent / 2
    const offset = ((halfExtent % step) + step) % step
    return Math.round((value - offset) / step) * step + offset
  }
  const swapAxes = Math.abs(Math.sin(yaw)) > 0.9
  const extentX = swapAxes ? dimensions[2] : dimensions[0]
  const extentZ = swapAxes ? dimensions[0] : dimensions[2]

  return [snapEdge(raw[0], extentX), 0, snapEdge(raw[2], extentZ)]
}
