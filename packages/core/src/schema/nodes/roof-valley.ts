import type { RoofSegmentNode } from './roof-segment'
import { getSegmentSlopeFrame, ROOF_SHAPE_DEFAULTS } from './roof-segment'
import {
  getRoofModuleFaces,
  getRoofShapeInsets,
  getRoofShapeRatios,
  type RoofShapeFaceVertex,
} from './roof-segment-shape'

export type RoofValleyPoint = { x: number; y: number; z: number }

export type OpenRoofValley = {
  start: RoofValleyPoint
  end: RoofValleyPoint
  firstEdge: [RoofValleyPoint, RoofValleyPoint]
  secondEdge: [RoofValleyPoint, RoofValleyPoint]
  segmentIds: [RoofSegmentNode['id'], RoofSegmentNode['id']]
}

type Point2 = [number, number]
type Plane = { x: number; z: number; constant: number }
type SurfaceFace = {
  plane: Plane
  polygon: Point2[]
  segmentId: RoofSegmentNode['id']
}

const EPSILON = 1e-6
const MIN_VALLEY_LENGTH = 0.08
const PAN_LIFT = 0.012

export function getOpenRoofValleys(
  segments: readonly RoofSegmentNode[],
  width = 0.35,
): OpenRoofValley[] {
  const facesBySegment = segments.map((segment) => buildSurfaceFaces(segment))
  const allFaces = facesBySegment.flat()
  const valleys: OpenRoofValley[] = []

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex++) {
      const firstFaces = facesBySegment[firstIndex] ?? []
      const secondFaces = facesBySegment[secondIndex] ?? []
      for (const first of firstFaces) {
        for (const second of secondFaces) {
          const valley = intersectFaces(first, second, allFaces, width)
          if (valley && !valleys.some((existing) => sameValley(existing, valley))) {
            valleys.push(valley)
          }
        }
      }
    }
  }

  return valleys
}

function buildSurfaceFaces(segment: RoofSegmentNode): SurfaceFace[] {
  const { roofType, width, depth, wallHeight, wallThickness, deckThickness, overhang } = segment
  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(segment)
  const verticalDeckThickness = activeRh > 0 ? deckThickness / cosTheta : deckThickness
  const deckExtension = wallThickness / 2 + overhang * cosTheta
  const shingleThickness = segment.shingleThickness ?? 0
  const shingleHorizontalOffset = shingleThickness * sinTheta
  const shingleVerticalOffset = shingleThickness * cosTheta
  const bottomWidth = Math.max(0.01, width + 2 * deckExtension)
  const bottomDepth = Math.max(0.01, depth + 2 * deckExtension)
  const deckDrop = deckExtension * tanTheta
  const bottomWallHeight = wallHeight - deckDrop + verticalDeckThickness

  let bottomRoofHeight = activeRh
  if (activeRh > 0) {
    bottomRoofHeight += deckDrop
    if (roofType === 'shed') bottomRoofHeight += deckDrop
  }

  let topWidth = bottomWidth
  let topDepth = bottomDepth
  let topTranslationZ = 0
  if (roofType === 'hip' || roofType === 'mansard' || roofType === 'dutch') {
    topWidth += 2 * shingleHorizontalOffset
    topDepth += 2 * shingleHorizontalOffset
  } else if (roofType === 'gable' || roofType === 'gambrel') {
    topDepth += 2 * shingleHorizontalOffset
  } else if (roofType === 'shed') {
    topDepth += shingleHorizontalOffset
    topTranslationZ = shingleHorizontalOffset / 2
  }

  const topWallHeight = bottomWallHeight + shingleVerticalOffset
  const topRoofHeight =
    activeRh > 0 ? bottomRoofHeight + shingleHorizontalOffset * tanTheta : bottomRoofHeight
  const availableRadius = (Math.min(bottomWidth, bottomDepth) / 2) * 0.95
  const maximumDrop = tanTheta > 0.001 ? availableRadius / tanTheta : 2
  const topBaseY = bottomWallHeight - Math.min(1, maximumDrop * 0.4)
  const dutchHipWidthRatio = segment.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio
  const insets = getRoofShapeInsets({
    roofType,
    width,
    depth,
    wh: topWallHeight,
    baseY: topBaseY,
    isVoid: false,
    brushW: topWidth,
    brushD: topDepth,
    tanTheta,
    shingleThickness,
    dutchHipWidthRatio,
  })
  const shapeRatios = getRoofShapeRatios({
    gambrelLowerWidthRatio: segment.gambrelLowerWidthRatio,
    mansardSteepWidthRatio: segment.mansardSteepWidthRatio,
    dutchHipWidthRatio,
    dutchHipHeightRatio: segment.dutchHipHeightRatio,
    dutchWaistLengthRatio: segment.dutchWaistLengthRatio,
    dutchGabletRake: segment.dutchGabletRake,
  })

  return getRoofModuleFaces({
    type: roofType,
    w: topWidth,
    d: topDepth,
    wh: topWallHeight,
    rh: topRoofHeight,
    baseY: topBaseY,
    insets,
    baseW: width,
    baseD: depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: segment.dutchTopRakeThickness,
  })
    .map((face) =>
      face.map((point) =>
        transformPoint(
          { ...point, z: point.z + topTranslationZ },
          segment.position,
          segment.rotation,
        ),
      ),
    )
    .map((vertices) => ({ vertices, plane: planeFromFace(vertices) }))
    .filter(
      (face): face is { vertices: RoofShapeFaceVertex[]; plane: Plane } => face.plane !== null,
    )
    .map(({ vertices, plane }) => ({
      plane,
      polygon: dedupePolygon(vertices.map((point) => [point.x, point.z])),
      segmentId: segment.id,
    }))
    .filter((face) => face.polygon.length >= 3)
}

function transformPoint(
  point: RoofShapeFaceVertex,
  position: readonly [number, number, number],
  rotation: number,
): RoofShapeFaceVertex {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: position[0] + point.x * cos + point.z * sin,
    y: position[1] + point.y,
    z: position[2] - point.x * sin + point.z * cos,
  }
}

function planeFromFace(vertices: readonly RoofShapeFaceVertex[]): Plane | null {
  const a = vertices[0]
  const b = vertices[1]
  const c = vertices[2]
  if (!(a && b && c)) return null
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  let nx = ab.y * ac.z - ab.z * ac.y
  let ny = ab.z * ac.x - ab.x * ac.z
  let nz = ab.x * ac.y - ab.y * ac.x
  if (ny < 0) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  if (ny <= EPSILON) return null
  return {
    x: -nx / ny,
    z: -nz / ny,
    constant: (nx * a.x + ny * a.y + nz * a.z) / ny,
  }
}

function intersectFaces(
  first: SurfaceFace,
  second: SurfaceFace,
  allFaces: readonly SurfaceFace[],
  width: number,
): OpenRoofValley | null {
  const equationX = first.plane.x - second.plane.x
  const equationZ = first.plane.z - second.plane.z
  const equationConstant = first.plane.constant - second.plane.constant
  const equationLengthSq = equationX * equationX + equationZ * equationZ
  if (equationLengthSq <= EPSILON * EPSILON) return null

  const equationLength = Math.sqrt(equationLengthSq)
  const direction: Point2 = [-equationZ / equationLength, equationX / equationLength]
  const linePoint: Point2 = [
    (-equationConstant * equationX) / equationLengthSq,
    (-equationConstant * equationZ) / equationLengthSq,
  ]
  const firstInterval = lineIntervalInPolygon(linePoint, direction, first.polygon)
  const secondInterval = lineIntervalInPolygon(linePoint, direction, second.polygon)
  if (!(firstInterval && secondInterval)) return null

  const startT = Math.max(firstInterval[0], secondInterval[0])
  const endT = Math.min(firstInterval[1], secondInterval[1])
  if (endT - startT < MIN_VALLEY_LENGTH) return null

  const gradient: Point2 = [equationX / equationLength, equationZ / equationLength]
  const midpointT = (startT + endT) / 2
  const midpoint: Point2 = [
    linePoint[0] + direction[0] * midpointT,
    linePoint[1] + direction[1] * midpointT,
  ]
  const sampleDistance = Math.min(0.04, (endT - startT) / 4)
  const positiveSample: Point2 = [
    midpoint[0] + gradient[0] * sampleDistance,
    midpoint[1] + gradient[1] * sampleDistance,
  ]
  const negativeSample: Point2 = [
    midpoint[0] - gradient[0] * sampleDistance,
    midpoint[1] - gradient[1] * sampleDistance,
  ]
  if (
    !pointInPolygon(positiveSample, first.polygon) ||
    !pointInPolygon(positiveSample, second.polygon) ||
    !pointInPolygon(negativeSample, first.polygon) ||
    !pointInPolygon(negativeSample, second.polygon)
  ) {
    return null
  }

  const firstDominatesPositive =
    heightAt(first.plane, positiveSample) > heightAt(second.plane, positiveSample)
  const positiveFace = firstDominatesPositive ? first : second
  const negativeFace = firstDominatesPositive ? second : first
  const seamHeight = heightAt(first.plane, midpoint)
  if (
    heightAt(positiveFace.plane, positiveSample) <= seamHeight + EPSILON ||
    heightAt(negativeFace.plane, negativeSample) <= seamHeight + EPSILON ||
    !isUpperEnvelopeFace(positiveFace, positiveSample, allFaces) ||
    !isUpperEnvelopeFace(negativeFace, negativeSample, allFaces)
  ) {
    return null
  }
  const halfWidth = Math.max(0.05, width / 2)
  const firstOffset: Point2 = firstDominatesPositive
    ? [gradient[0] * halfWidth, gradient[1] * halfWidth]
    : [-gradient[0] * halfWidth, -gradient[1] * halfWidth]
  const secondOffset: Point2 = [-firstOffset[0], -firstOffset[1]]
  const start2: Point2 = [
    linePoint[0] + direction[0] * startT,
    linePoint[1] + direction[1] * startT,
  ]
  const end2: Point2 = [linePoint[0] + direction[0] * endT, linePoint[1] + direction[1] * endT]

  return {
    start: pointOnPlane(first.plane, start2),
    end: pointOnPlane(first.plane, end2),
    firstEdge: [
      pointOnPlane(first.plane, [start2[0] + firstOffset[0], start2[1] + firstOffset[1]]),
      pointOnPlane(first.plane, [end2[0] + firstOffset[0], end2[1] + firstOffset[1]]),
    ],
    secondEdge: [
      pointOnPlane(second.plane, [start2[0] + secondOffset[0], start2[1] + secondOffset[1]]),
      pointOnPlane(second.plane, [end2[0] + secondOffset[0], end2[1] + secondOffset[1]]),
    ],
    segmentIds: [first.segmentId, second.segmentId],
  }
}

function isUpperEnvelopeFace(
  candidate: SurfaceFace,
  point: Point2,
  faces: readonly SurfaceFace[],
): boolean {
  const candidateHeight = heightAt(candidate.plane, point)
  return faces.every(
    (face) =>
      !pointInPolygon(point, face.polygon) ||
      heightAt(face.plane, point) <= candidateHeight + EPSILON,
  )
}

function pointOnPlane(plane: Plane, point: Point2): RoofValleyPoint {
  return { x: point[0], y: heightAt(plane, point) + PAN_LIFT, z: point[1] }
}

function heightAt(plane: Plane, point: Point2): number {
  return plane.x * point[0] + plane.z * point[1] + plane.constant
}

function lineIntervalInPolygon(
  linePoint: Point2,
  direction: Point2,
  polygon: readonly Point2[],
): [number, number] | null {
  const hits: number[] = []
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    const edge: Point2 = [b[0] - a[0], b[1] - a[1]]
    const offset: Point2 = [a[0] - linePoint[0], a[1] - linePoint[1]]
    const denominator = cross(direction, edge)
    if (Math.abs(denominator) <= EPSILON) {
      if (Math.abs(cross(offset, direction)) <= EPSILON) {
        hits.push(dot(offset, direction))
        hits.push(dot([b[0] - linePoint[0], b[1] - linePoint[1]], direction))
      }
      continue
    }
    const t = cross(offset, edge) / denominator
    const edgeT = cross(offset, direction) / denominator
    if (edgeT >= -EPSILON && edgeT <= 1 + EPSILON) hits.push(t)
  }
  if (hits.length < 2) return null
  return [Math.min(...hits), Math.max(...hits)]
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!
    const b = polygon[previous]!
    if (pointOnSegment(point, a, b)) return true
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function pointOnSegment(point: Point2, a: Point2, b: Point2): boolean {
  const ab: Point2 = [b[0] - a[0], b[1] - a[1]]
  const ap: Point2 = [point[0] - a[0], point[1] - a[1]]
  return (
    Math.abs(cross(ab, ap)) <= EPSILON &&
    dot(ap, ab) >= -EPSILON &&
    dot(ap, ab) <= dot(ab, ab) + EPSILON
  )
}

function dedupePolygon(points: Point2[]): Point2[] {
  const result: Point2[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (previous && Math.hypot(previous[0] - point[0], previous[1] - point[1]) <= EPSILON) continue
    result.push(point)
  }
  const first = result[0]
  const last = result.at(-1)
  if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPSILON) result.pop()
  return result
}

function sameValley(first: OpenRoofValley, second: OpenRoofValley): boolean {
  const sameDirection =
    distance(first.start, second.start) < 0.02 && distance(first.end, second.end) < 0.02
  const oppositeDirection =
    distance(first.start, second.end) < 0.02 && distance(first.end, second.start) < 0.02
  return sameDirection || oppositeDirection
}

function distance(a: RoofValleyPoint, b: RoofValleyPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function cross(a: Point2, b: Point2): number {
  return a[0] * b[1] - a[1] * b[0]
}

function dot(a: Point2, b: Point2): number {
  return a[0] * b[0] + a[1] * b[1]
}
