import type { ConstructionDimensionNode, FloorplanPoint, MeasurementPoint } from '@pascal-app/core'

export type ConstructionDimensionSegmentLayout = {
  dimensionStart: FloorplanPoint
  dimensionEnd: FloorplanPoint
  value: number
  witnessStart: FloorplanPoint
  witnessEnd: FloorplanPoint
}

export type ConstructionDimensionLayout = {
  dimensionPoints: FloorplanPoint[]
  direction: FloorplanPoint
  midpoint: FloorplanPoint
  normal: FloorplanPoint
  segments: ConstructionDimensionSegmentLayout[]
  witnessPoints: FloorplanPoint[]
}

const project = (point: MeasurementPoint): FloorplanPoint => [point[0], point[2]]

export function resolveConstructionDimensionLayout(
  node: Pick<ConstructionDimensionNode, 'baseline'>,
  anchors: readonly MeasurementPoint[],
): ConstructionDimensionLayout {
  if (anchors.length < 2) {
    throw new Error('Construction dimension layout requires at least two anchors')
  }
  const magnitude = Math.hypot(node.baseline.direction[0], node.baseline.direction[1])
  const direction: FloorplanPoint = [
    node.baseline.direction[0] / magnitude,
    node.baseline.direction[1] / magnitude,
  ]
  const normal: FloorplanPoint = [-direction[1], direction[0]]
  const witnessPoints = anchors.map(project)
  const dimensionPoints = witnessPoints.map((point): FloorplanPoint => {
    const deltaX = point[0] - node.baseline.origin[0]
    const deltaY = point[1] - node.baseline.origin[1]
    const distance = deltaX * direction[0] + deltaY * direction[1]
    return [
      node.baseline.origin[0] + distance * direction[0],
      node.baseline.origin[1] + distance * direction[1],
    ]
  })
  const segments = witnessPoints.slice(0, -1).map((witnessStart, index) => {
    const witnessEnd = witnessPoints[index + 1]!
    const dimensionStart = dimensionPoints[index]!
    const dimensionEnd = dimensionPoints[index + 1]!
    return {
      dimensionStart,
      dimensionEnd,
      value: Math.abs(
        (witnessEnd[0] - witnessStart[0]) * direction[0] +
          (witnessEnd[1] - witnessStart[1]) * direction[1],
      ),
      witnessStart,
      witnessEnd,
    }
  })
  const first = dimensionPoints[0]!
  const last = dimensionPoints.at(-1)!
  return {
    dimensionPoints,
    direction,
    midpoint: [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2],
    normal,
    segments,
    witnessPoints,
  }
}
