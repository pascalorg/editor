export type FloorplanGridEventPoint = [number, number]

export function resolveGenericFloorplanGridEventPoint({
  point,
  registryToolOwnsSnapping,
  snap,
}: {
  point: FloorplanGridEventPoint
  registryToolOwnsSnapping: boolean
  snap: (point: FloorplanGridEventPoint) => FloorplanGridEventPoint
}): FloorplanGridEventPoint {
  return registryToolOwnsSnapping ? point : snap(point)
}
