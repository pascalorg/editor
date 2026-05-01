import type { Point2D, StairNode, StairSegmentNode } from '@pascal-app/core'
import {
  clampPlanValue,
  getPlanPointDistance,
  getThickPlanLinePolygon,
  interpolatePlanPoint,
  movePlanPointTowards,
  rotatePlanVector,
} from './geometry'
import type {
  FloorplanLineSegment,
  FloorplanStairArrowEntry,
  FloorplanStairEntry,
  FloorplanStairSegmentEntry,
  StairSegmentTransform,
} from './types'

const FLOORPLAN_STAIR_OUTLINE_BAND_THICKNESS = 0.05
const FLOORPLAN_STAIR_OUTLINE_MAX_FRACTION = 0.18
const FLOORPLAN_STAIR_TREAD_BAND_THICKNESS = 0.05 * 0.82
const FLOORPLAN_STAIR_TREAD_MIN_THICKNESS = 0.02 * 1.5
const FLOORPLAN_STAIR_ARROW_HEAD_MIN_SIZE = 0.14
const FLOORPLAN_STAIR_ARROW_HEAD_MAX_SIZE = 0.24

type FloorplanStairArrowSide = 'back' | 'front' | 'left' | 'right'

function getFloorplanStairSegmentCenterLine(polygon: Point2D[]): FloorplanLineSegment | null {
  if (polygon.length < 4) {
    return null
  }

  const [backLeft, backRight, frontRight, frontLeft] = polygon

  return {
    start: interpolatePlanPoint(backLeft!, backRight!, 0.5),
    end: interpolatePlanPoint(frontLeft!, frontRight!, 0.5),
  }
}

function getFloorplanStairInnerPolygon(polygon: Point2D[]): Point2D[] {
  if (polygon.length < 4) {
    return polygon
  }

  const [backLeft, backRight, frontRight, frontLeft] = polygon
  const outerWidth = getPlanPointDistance(backLeft!, backRight!)
  const outerLength = getPlanPointDistance(backLeft!, frontLeft!)
  const widthInset = Math.min(
    FLOORPLAN_STAIR_OUTLINE_BAND_THICKNESS,
    outerWidth * FLOORPLAN_STAIR_OUTLINE_MAX_FRACTION,
  )
  const lengthInset = Math.min(
    FLOORPLAN_STAIR_OUTLINE_BAND_THICKNESS,
    outerLength * FLOORPLAN_STAIR_OUTLINE_MAX_FRACTION,
  )

  const insetBackLeft = movePlanPointTowards(backLeft!, frontLeft!, lengthInset)
  const insetBackRight = movePlanPointTowards(backRight!, frontRight!, lengthInset)
  const insetFrontLeft = movePlanPointTowards(frontLeft!, backLeft!, lengthInset)
  const insetFrontRight = movePlanPointTowards(frontRight!, backRight!, lengthInset)

  const innerPolygon = [
    movePlanPointTowards(insetBackLeft, insetBackRight, widthInset),
    movePlanPointTowards(insetBackRight, insetBackLeft, widthInset),
    movePlanPointTowards(insetFrontRight, insetFrontLeft, widthInset),
    movePlanPointTowards(insetFrontLeft, insetFrontRight, widthInset),
  ]

  const innerWidth = getPlanPointDistance(innerPolygon[0]!, innerPolygon[1]!)
  const innerLength = getPlanPointDistance(innerPolygon[0]!, innerPolygon[3]!)

  return innerWidth > 0.06 && innerLength > 0.06 ? innerPolygon : polygon
}

function getFloorplanStairTreadLines(
  segment: StairSegmentNode,
  innerPolygon: Point2D[],
): FloorplanLineSegment[] {
  if (segment.segmentType !== 'stair' || segment.stepCount <= 1 || innerPolygon.length < 4) {
    return []
  }

  const [backLeft, backRight, frontRight, frontLeft] = innerPolygon
  const treadLines: FloorplanLineSegment[] = []

  for (let stepIndex = 1; stepIndex < segment.stepCount; stepIndex += 1) {
    const t = stepIndex / segment.stepCount
    treadLines.push({
      start: interpolatePlanPoint(backLeft!, frontLeft!, t),
      end: interpolatePlanPoint(backRight!, frontRight!, t),
    })
  }

  return treadLines
}

function getFloorplanStairTreadThickness(segment: StairSegmentNode, innerPolygon: Point2D[]) {
  if (segment.segmentType !== 'stair' || segment.stepCount <= 1 || innerPolygon.length < 4) {
    return 0
  }

  const innerWidth = getPlanPointDistance(innerPolygon[0]!, innerPolygon[1]!)
  const innerLength = getPlanPointDistance(innerPolygon[0]!, innerPolygon[3]!)
  const treadRun = innerLength / Math.max(segment.stepCount, 1)
  return clampPlanValue(
    Math.min(FLOORPLAN_STAIR_TREAD_BAND_THICKNESS, innerWidth * 0.12, treadRun * 0.44),
    FLOORPLAN_STAIR_TREAD_MIN_THICKNESS,
    FLOORPLAN_STAIR_TREAD_BAND_THICKNESS,
  )
}

function getFloorplanStairTreadBars(
  segment: StairSegmentNode,
  innerPolygon: Point2D[],
  treadThickness = getFloorplanStairTreadThickness(segment, innerPolygon),
): Point2D[][] {
  const treadLines = getFloorplanStairTreadLines(segment, innerPolygon)
  if (treadLines.length === 0 || treadThickness <= 0) {
    return []
  }

  return treadLines.map((line) => getThickPlanLinePolygon(line, treadThickness))
}

function getFloorplanStairSegmentCenterPoint(segment: FloorplanStairSegmentEntry): Point2D | null {
  if (segment.centerLine) {
    return interpolatePlanPoint(segment.centerLine.start, segment.centerLine.end, 0.5)
  }

  if (segment.polygon.length < 4) {
    return null
  }

  const [backLeft, backRight, frontRight, frontLeft] = segment.polygon

  return {
    x: (backLeft!.x + backRight!.x + frontRight!.x + frontLeft!.x) / 4,
    y: (backLeft!.y + backRight!.y + frontRight!.y + frontLeft!.y) / 4,
  }
}

function getFloorplanStairSegmentSidePoint(
  segment: FloorplanStairSegmentEntry,
  side: FloorplanStairArrowSide,
): Point2D | null {
  if (segment.polygon.length < 4) {
    return null
  }

  const [backLeft, backRight, frontRight, frontLeft] = segment.polygon

  switch (side) {
    case 'back':
      return interpolatePlanPoint(backLeft!, backRight!, 0.5)
    case 'front':
      return interpolatePlanPoint(frontLeft!, frontRight!, 0.5)
    case 'left':
      return interpolatePlanPoint(backLeft!, frontLeft!, 0.5)
    case 'right':
      return interpolatePlanPoint(backRight!, frontRight!, 0.5)
  }
}

function getFloorplanStairExitSide(
  nextSegment: StairSegmentNode | undefined,
): FloorplanStairArrowSide {
  if (!nextSegment) {
    return 'front'
  }

  if (nextSegment.attachmentSide === 'left') {
    return 'right'
  }
  if (nextSegment.attachmentSide === 'right') {
    return 'left'
  }

  return 'front'
}

function appendUniquePlanPoint(points: Point2D[], point: Point2D | null) {
  if (!point) {
    return
  }

  const lastPoint = points[points.length - 1]
  if (lastPoint && getPlanPointDistance(lastPoint, point) <= 0.001) {
    return
  }

  points.push(point)
}

function getFloorplanArcPoint(center: Point2D, radius: number, angle: number): Point2D {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
}

function getNormalizedFloorplanStairSweepAngle(stair: StairNode) {
  const stairType = stair.stairType ?? 'straight'
  const baseSweepAngle = stair.sweepAngle ?? (stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)

  if (Math.abs(baseSweepAngle) >= Math.PI * 2) {
    return Math.sign(baseSweepAngle || 1) * (Math.PI * 2 - 0.001)
  }

  return baseSweepAngle
}

function getFloorplanSpiralLandingSweep(stair: StairNode, sweepAngle: number) {
  if (
    (stair.stairType ?? 'straight') !== 'spiral' ||
    (stair.topLandingMode ?? 'none') !== 'integrated'
  ) {
    return 0
  }

  const innerRadius = Math.max(0.05, stair.innerRadius ?? 0.9)
  const width = Math.max(stair.width ?? 1, 0.4)
  const landingDepth = Math.max(0.3, stair.topLandingDepth ?? Math.max(width * 0.9, 0.8))

  return (
    Math.min(Math.PI * 0.75, landingDepth / Math.max(innerRadius + width / 2, 0.1)) *
    Math.sign(sweepAngle || 1)
  )
}

function getFloorplanCurvedStairHitPolygon(stair: StairNode): Point2D[] {
  const stairType = stair.stairType ?? 'straight'
  const sweepAngle = getNormalizedFloorplanStairSweepAngle(stair)
  const startAngle = -stair.rotation - sweepAngle / 2
  const endAngle = startAngle + sweepAngle + getFloorplanSpiralLandingSweep(stair, sweepAngle)
  const center = {
    x: stair.position[0],
    y: stair.position[2],
  }
  const innerRadius = Math.max(
    stairType === 'spiral' ? 0.05 : 0.2,
    stair.innerRadius ?? (stairType === 'spiral' ? 0.2 : 0.9),
  )
  const outerRadius = innerRadius + stair.width
  const outerArcLength = Math.abs(sweepAngle) * outerRadius
  const segmentCount = Math.max(
    24,
    Math.ceil(Math.abs(sweepAngle) / (Math.PI / 24)),
    Math.ceil(outerArcLength / 0.14),
  )
  const outerPoints: Point2D[] = []
  const innerPoints: Point2D[] = []

  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount
    const angle = startAngle + (endAngle - startAngle) * t
    outerPoints.push(getFloorplanArcPoint(center, outerRadius, angle))
    innerPoints.push(getFloorplanArcPoint(center, innerRadius, angle))
  }

  return [...outerPoints, ...innerPoints.reverse()]
}

function buildFloorplanStairArrow(
  segments: FloorplanStairSegmentEntry[],
): FloorplanStairArrowEntry | null {
  const rawPoints: Point2D[] = []

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!
    const nextSegment = segments[segmentIndex + 1]?.segment
    const entryPoint = getFloorplanStairSegmentSidePoint(segment, 'back')
    const exitPoint = getFloorplanStairSegmentSidePoint(
      segment,
      getFloorplanStairExitSide(nextSegment),
    )

    if (!(entryPoint && exitPoint)) {
      continue
    }

    appendUniquePlanPoint(rawPoints, entryPoint)

    const isStraightSegment = getPlanPointDistance(entryPoint, exitPoint) <= 0.001
    if (isStraightSegment) {
      continue
    }

    const exitSide = getFloorplanStairExitSide(nextSegment)
    if (exitSide === 'front') {
      appendUniquePlanPoint(rawPoints, exitPoint)
      continue
    }

    appendUniquePlanPoint(rawPoints, getFloorplanStairSegmentCenterPoint(segment))
    appendUniquePlanPoint(rawPoints, exitPoint)
  }

  if (rawPoints.length < 2) {
    return null
  }

  const firstPoint = rawPoints[0]!
  const secondPoint = rawPoints[1]!
  const beforeLastPoint = rawPoints[rawPoints.length - 2]!
  const lastPoint = rawPoints[rawPoints.length - 1]!
  const firstLength = getPlanPointDistance(firstPoint, secondPoint)
  const lastLength = getPlanPointDistance(beforeLastPoint, lastPoint)

  if (firstLength <= Number.EPSILON || lastLength <= Number.EPSILON) {
    return null
  }

  const polyline = [
    movePlanPointTowards(firstPoint, secondPoint, Math.min(0.24, firstLength * 0.18)),
    ...rawPoints.slice(1, -1),
    movePlanPointTowards(lastPoint, beforeLastPoint, Math.min(0.3, lastLength * 0.22)),
  ]
  const arrowTailPoint = polyline[polyline.length - 2]
  const arrowTip = polyline[polyline.length - 1]

  if (!(arrowTailPoint && arrowTip)) {
    return null
  }

  const arrowBodyLength = getPlanPointDistance(arrowTailPoint, arrowTip)
  if (arrowBodyLength <= Number.EPSILON) {
    return null
  }

  const arrowHeadLength = clampPlanValue(
    arrowBodyLength * 0.72,
    FLOORPLAN_STAIR_ARROW_HEAD_MIN_SIZE,
    FLOORPLAN_STAIR_ARROW_HEAD_MAX_SIZE,
  )
  const arrowHeadBase = movePlanPointTowards(arrowTip, arrowTailPoint, arrowHeadLength)
  const directionX = arrowTip.x - arrowHeadBase.x
  const directionY = arrowTip.y - arrowHeadBase.y
  const directionLength = Math.hypot(directionX, directionY)

  if (directionLength <= Number.EPSILON) {
    return null
  }

  const normalX = -directionY / directionLength
  const normalY = directionX / directionLength
  const arrowHeadHalfWidth = arrowHeadLength * 0.34

  return {
    head: [
      arrowTip,
      {
        x: arrowHeadBase.x + normalX * arrowHeadHalfWidth,
        y: arrowHeadBase.y + normalY * arrowHeadHalfWidth,
      },
      {
        x: arrowHeadBase.x - normalX * arrowHeadHalfWidth,
        y: arrowHeadBase.y - normalY * arrowHeadHalfWidth,
      },
    ],
    polyline,
  }
}

export function computeFloorplanStairSegmentTransforms(
  segments: StairSegmentNode[],
): StairSegmentTransform[] {
  const transforms: StairSegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRotation = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!

    if (index === 0) {
      transforms.push({
        position: [currentX, currentY, currentZ],
        rotation: currentRotation,
      })
      continue
    }

    const previousSegment = segments[index - 1]!
    let attachX = 0
    let attachY = previousSegment.height
    let attachZ = previousSegment.length
    let rotationDelta = 0

    if (segment.attachmentSide === 'left') {
      attachX = previousSegment.width / 2
      attachZ = previousSegment.length / 2
      rotationDelta = Math.PI / 2
    } else if (segment.attachmentSide === 'right') {
      attachX = -previousSegment.width / 2
      attachZ = previousSegment.length / 2
      rotationDelta = -Math.PI / 2
    }

    const [rotatedAttachX, rotatedAttachZ] = rotatePlanVector(attachX, attachZ, currentRotation)
    currentX += rotatedAttachX
    currentY += attachY
    currentZ += rotatedAttachZ
    currentRotation += rotationDelta

    transforms.push({
      position: [currentX, currentY, currentZ],
      rotation: currentRotation,
    })
  }

  return transforms
}

export function getFloorplanStairSegmentPolygon(
  stair: StairNode,
  segment: StairSegmentNode,
  transform: StairSegmentTransform,
): Point2D[] {
  const halfWidth = segment.width / 2
  const localCorners: Array<[number, number]> = [
    [-halfWidth, 0],
    [halfWidth, 0],
    [halfWidth, segment.length],
    [-halfWidth, segment.length],
  ]

  return localCorners.map(([localX, localY]) => {
    const [segmentX, segmentY] = rotatePlanVector(localX, localY, transform.rotation)
    const groupX = transform.position[0] + segmentX
    const groupY = transform.position[2] + segmentY
    const [worldOffsetX, worldOffsetY] = rotatePlanVector(groupX, groupY, stair.rotation)

    return {
      x: stair.position[0] + worldOffsetX,
      y: stair.position[2] + worldOffsetY,
    }
  })
}

export function buildFloorplanStairEntry(
  stair: StairNode,
  segments: StairSegmentNode[],
): FloorplanStairEntry | null {
  const stairType = stair.stairType ?? 'straight'

  if (segments.length === 0 && stairType === 'straight') {
    return null
  }

  const transforms = computeFloorplanStairSegmentTransforms(segments)
  const segmentEntries = segments.map((segment, index) => {
    const polygon = getFloorplanStairSegmentPolygon(stair, segment, transforms[index]!)
    const centerLine = getFloorplanStairSegmentCenterLine(polygon)
    const innerPolygon = getFloorplanStairInnerPolygon(polygon)
    const treadThickness = getFloorplanStairTreadThickness(segment, innerPolygon)

    return {
      centerLine,
      innerPolygon,
      segment,
      polygon,
      treadBars: getFloorplanStairTreadBars(segment, innerPolygon, treadThickness),
      treadThickness,
    }
  })
  const hitPolygons =
    stairType === 'straight'
      ? segmentEntries.map(({ polygon }) => polygon)
      : [getFloorplanCurvedStairHitPolygon(stair)]

  return {
    arrow: buildFloorplanStairArrow(segmentEntries),
    hitPolygons,
    stair,
    segments: segmentEntries,
  }
}
