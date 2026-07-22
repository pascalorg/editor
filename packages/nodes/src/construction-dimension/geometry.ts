import type {
  ConstructionDimensionMode,
  ConstructionDimensionNode,
  FloorplanPoint,
  MeasurementPoint,
} from '@pascal-app/core'

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

export type CircularConstructionDimensionLayout = {
  center: FloorplanPoint
  start: FloorplanPoint
  end: FloorplanPoint | null
  radius: number
  startAngle: number
  endAngle: number
  sweep: number
  chordLength: number
  arcLength: number
}

export function resolveCircularConstructionDimensionLayout(
  mode: ConstructionDimensionMode,
  anchors: readonly MeasurementPoint[],
): CircularConstructionDimensionLayout | null {
  if (anchors.length < 2) return null
  const first = project(anchors[0]!)
  const second = project(anchors[1]!)

  if (mode === 'diameter') {
    const center: FloorplanPoint = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]
    const radius = distance(first, second) / 2
    if (radius <= 1e-9) return null
    return {
      center,
      start: first,
      end: second,
      radius,
      startAngle: Math.atan2(first[1] - center[1], first[0] - center[0]),
      endAngle: Math.atan2(second[1] - center[1], second[0] - center[0]),
      sweep: Math.PI,
      chordLength: radius * 2,
      arcLength: Math.PI * radius,
    }
  }

  const usesMiddleCenter = mode === 'arc-length' || mode === 'angular'
  const center = usesMiddleCenter ? second : first
  const start = usesMiddleCenter ? first : second
  const radius = distance(center, start)
  if (radius <= 1e-9) return null
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAnchor = anchors[2]
  const end = endAnchor ? project(endAnchor) : null
  const endAngle = end ? Math.atan2(end[1] - center[1], end[0] - center[0]) : startAngle
  const sweep = end ? normalizedSignedSweep(startAngle, endAngle) : 0
  return {
    center,
    start,
    end,
    radius,
    startAngle,
    endAngle,
    sweep,
    chordLength: end ? distance(start, end) : radius,
    arcLength: Math.abs(sweep) * radius,
  }
}

function normalizedSignedSweep(startAngle: number, endAngle: number): number {
  let sweep = endAngle - startAngle
  while (sweep > Math.PI) sweep -= Math.PI * 2
  while (sweep <= -Math.PI) sweep += Math.PI * 2
  return sweep
}

function distance(first: FloorplanPoint, second: FloorplanPoint): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

export function resolveConstructionDimensionLayout(
  node: Pick<ConstructionDimensionNode, 'baseline' | 'chainMode'>,
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
  const segmentIndexes =
    node.chainMode === 'continuous'
      ? witnessPoints.slice(0, -1).map((_, index) => [index, index + 1] as const)
      : Array.from(
          { length: Math.floor(witnessPoints.length / 2) },
          (_, index) => [index * 2, index * 2 + 1] as const,
        )
  const segments = segmentIndexes.map(([startIndex, endIndex]) => {
    const witnessStart = witnessPoints[startIndex]!
    const witnessEnd = witnessPoints[endIndex]!
    const dimensionStart = dimensionPoints[startIndex]!
    const dimensionEnd = dimensionPoints[endIndex]!
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
