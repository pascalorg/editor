import type { ConstructionDimensionNode, FloorplanPoint, MeasurementPoint } from '@pascal-app/core'

export type ConstructionDimensionLayout = {
  dimensionStart: FloorplanPoint
  dimensionEnd: FloorplanPoint
  direction: FloorplanPoint
  midpoint: FloorplanPoint
  normal: FloorplanPoint
  value: number
  witnessStart: FloorplanPoint
  witnessEnd: FloorplanPoint
}

const project = (point: MeasurementPoint): FloorplanPoint => [point[0], point[2]]

export function resolveConstructionDimensionLayout(
  node: Pick<ConstructionDimensionNode, 'baseline'>,
  anchors: readonly [MeasurementPoint, MeasurementPoint],
): ConstructionDimensionLayout {
  const magnitude = Math.hypot(node.baseline.direction[0], node.baseline.direction[1])
  const direction: FloorplanPoint = [
    node.baseline.direction[0] / magnitude,
    node.baseline.direction[1] / magnitude,
  ]
  const normal: FloorplanPoint = [-direction[1], direction[0]]
  const witnessStart = project(anchors[0])
  const witnessEnd = project(anchors[1])
  const projectToBaseline = (point: FloorplanPoint): FloorplanPoint => {
    const deltaX = point[0] - node.baseline.origin[0]
    const deltaY = point[1] - node.baseline.origin[1]
    const distance = deltaX * direction[0] + deltaY * direction[1]
    return [
      node.baseline.origin[0] + distance * direction[0],
      node.baseline.origin[1] + distance * direction[1],
    ]
  }
  const dimensionStart = projectToBaseline(witnessStart)
  const dimensionEnd = projectToBaseline(witnessEnd)
  return {
    dimensionStart,
    dimensionEnd,
    direction,
    midpoint: [
      (dimensionStart[0] + dimensionEnd[0]) / 2,
      (dimensionStart[1] + dimensionEnd[1]) / 2,
    ],
    normal,
    value: Math.abs(
      (witnessEnd[0] - witnessStart[0]) * direction[0] +
        (witnessEnd[1] - witnessStart[1]) * direction[1],
    ),
    witnessStart,
    witnessEnd,
  }
}
