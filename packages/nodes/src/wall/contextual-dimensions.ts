import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceOffsets,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'
import {
  formatLinearMeasurement,
  readFloorplanContext,
  readFloorplanMetricNotationOverride,
} from '@pascal-app/editor'

type WallHostedOpening = {
  position: readonly [number, number, number]
  width: number
}

type OpeningDimensionOptions = {
  showClearancesWhileMoving: boolean
  useExteriorNormal: boolean
}

const WALL_CONNECTION_TOLERANCE = 0.03

function formatLength(value: number, ctx: GeometryContext): string {
  return formatLinearMeasurement(
    value,
    ctx.viewState?.unit ?? 'metric',
    readFloorplanMetricNotationOverride(ctx) ?? 'meters',
  )
}

function selectedStroke(ctx: GeometryContext): string {
  return ctx.viewState?.palette?.selectedStroke ?? '#2563eb'
}

function contextualWallDimensionNormal(
  wall: WallNode,
  frontNormal: FloorplanPoint,
  siblings: GeometryContext['siblings'],
): FloorplanPoint {
  const front: FloorplanPoint = [cleanZero(frontNormal[0]), cleanZero(frontNormal[1])]
  const back: FloorplanPoint = [cleanZero(-front[0]), cleanZero(-front[1])]
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') return front
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') return back
  if (wall.frontSide === 'interior' && wall.backSide === 'interior') return front

  const walls = [
    wall,
    ...siblings.filter((sibling): sibling is WallNode => sibling.type === 'wall'),
  ]
  let centroidX = 0
  let centroidY = 0
  for (const candidate of walls) {
    centroidX += candidate.start[0] + candidate.end[0]
    centroidY += candidate.start[1] + candidate.end[1]
  }
  const centroid: FloorplanPoint = [centroidX / (walls.length * 2), centroidY / (walls.length * 2)]
  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  const towardFront =
    (midpoint[0] - centroid[0]) * front[0] + (midpoint[1] - centroid[1]) * front[1]
  return towardFront >= 0 ? front : back
}

function cleanZero(value: number): number {
  return Math.abs(value) <= Number.EPSILON ? 0 : value
}

function cross(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[1] - left[1] * right[0]
}

function pointSegmentDistance(
  point: FloorplanPoint,
  start: FloorplanPoint,
  end: FloorplanPoint,
): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t))
}

function structuralFaceProjections(
  /** A point on the measured line (the centerline or one face) at the wall's start. */
  wallStart: FloorplanPoint,
  wallTangent: FloorplanPoint,
  connectedWall: WallNode,
): number[] {
  if (isCurvedWall(connectedWall)) return []
  const dx = connectedWall.end[0] - connectedWall.start[0]
  const dy = connectedWall.end[1] - connectedWall.start[1]
  const length = Math.hypot(dx, dy)
  if (length <= 1e-6) return []
  const direction: FloorplanPoint = [dx / length, dy / length]
  const denominator = cross(wallTangent, direction)
  if (Math.abs(denominator) <= 1e-6) return []
  const normal: FloorplanPoint = [-direction[1], direction[0]]

  const { a, b } = getWallFaceOffsets(connectedWall)
  return [b, a].map((offset) => {
    const facePoint: FloorplanPoint = [
      connectedWall.start[0] + normal[0] * offset,
      connectedWall.start[1] + normal[1] * offset,
    ]
    return (
      cross([facePoint[0] - wallStart[0], facePoint[1] - wallStart[1]], direction) / denominator
    )
  })
}

function wallStudFaceSpan(
  wall: WallNode,
  siblings: GeometryContext['siblings'],
): { end: FloorplanPoint; length: number; start: FloorplanPoint } {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const centerlineLength = Math.hypot(dx, dy)
  if (centerlineLength <= 1e-6) {
    return { start: wall.start, end: wall.end, length: centerlineLength }
  }

  const tangent: FloorplanPoint = [dx / centerlineLength, dy / centerlineLength]
  let startProjection = 0
  let endProjection = centerlineLength

  for (const sibling of siblings) {
    if (sibling.type !== 'wall' || sibling.id === wall.id) continue
    const projections = structuralFaceProjections(wall.start, tangent, sibling)
    if (pointSegmentDistance(wall.start, sibling.start, sibling.end) <= WALL_CONNECTION_TOLERANCE) {
      for (const projection of projections) {
        if (projection > startProjection && projection < endProjection) {
          startProjection = projection
        }
      }
    }
    if (pointSegmentDistance(wall.end, sibling.start, sibling.end) <= WALL_CONNECTION_TOLERANCE) {
      for (const projection of projections) {
        if (projection > startProjection && projection < endProjection) {
          endProjection = projection
        }
      }
    }
  }

  const start: FloorplanPoint = [
    wall.start[0] + tangent[0] * startProjection,
    wall.start[1] + tangent[1] * startProjection,
  ]
  const end: FloorplanPoint = [
    wall.start[0] + tangent[0] * endProjection,
    wall.start[1] + tangent[1] * endProjection,
  ]
  return { start, end, length: Math.max(0, endProjection - startProjection) }
}

type FaceSpan = { end: FloorplanPoint; length: number; start: FloorplanPoint }

function nearPlanPoint(left: FloorplanPoint, right: FloorplanPoint): boolean {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= WALL_CONNECTION_TOLERANCE
}

/**
 * One face of a straight wall, from end to end. `inner` stops at the near
 * face of each connected wall (an interior face, the room size); `outer`
 * runs on to the far face of a wall that turns the corner with it (an
 * exterior face, the outside size). A wall that only abuts another (a T)
 * stops at its near face either way, and a free end at the end cap.
 */
function wallFaceSpan(
  wall: WallNode,
  side: 'a' | 'b',
  siblings: GeometryContext['siblings'],
  reach: 'inner' | 'outer',
): FaceSpan | null {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length <= 1e-6) return null
  const tangent: FloorplanPoint = [dx / length, dy / length]
  const offset = getWallFaceOffsets(wall)[side]
  const origin: FloorplanPoint = [
    wall.start[0] - tangent[1] * offset,
    wall.start[1] + tangent[0] * offset,
  ]

  const resolveEnd = (endpoint: FloorplanPoint, atStart: boolean): number => {
    const rest = atStart ? 0 : length
    let near: number | null = null
    let far: number | null = null
    for (const sibling of siblings) {
      if (sibling.type !== 'wall' || sibling.id === wall.id) continue
      if (pointSegmentDistance(endpoint, sibling.start, sibling.end) > WALL_CONNECTION_TOLERANCE) {
        continue
      }
      const corner = nearPlanPoint(endpoint, sibling.start) || nearPlanPoint(endpoint, sibling.end)
      for (const projection of structuralFaceProjections(origin, tangent, sibling)) {
        const inward = atStart ? projection : length - projection
        if (inward > 0 && inward < length) {
          if (near === null || inward > (atStart ? near : length - near)) near = projection
        } else if (corner && inward < 0 && inward > -length) {
          if (far === null || inward < (atStart ? far : length - far)) far = projection
        }
      }
    }
    if (reach === 'outer' && far !== null) return far
    return near ?? rest
  }

  const startProjection = resolveEnd(wall.start, true)
  const endProjection = resolveEnd(wall.end, false)
  if (endProjection - startProjection <= 1e-6) return null
  return {
    start: [origin[0] + tangent[0] * startProjection, origin[1] + tangent[1] * startProjection],
    end: [origin[0] + tangent[0] * endProjection, origin[1] + tangent[1] * endProjection],
    length: endProjection - startProjection,
  }
}

function faceDimension(
  span: FaceSpan,
  offsetNormal: FloorplanPoint,
  ctx: GeometryContext,
): FloorplanGeometry {
  return {
    kind: 'dimension',
    start: span.start,
    end: span.end,
    offsetNormal,
    offsetDistance: 0.34,
    extensionOvershoot: 0.08,
    text: formatLength(span.length, ctx),
    stroke: selectedStroke(ctx),
  }
}

/**
 * A selected wall's length, to its faces rather than its centerline: the
 * interior face (ID) on the room side and the exterior face (OD) outside, as
 * the dimension-faces preference asks. An interior partition has no outside,
 * so it shows its clear span between the walls it runs to.
 */
export function buildWallContextualDimensions(
  node: WallNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const length = getWallCurveLength(node)
  if (!Number.isFinite(length) || length <= 1e-6) return null

  if (isCurvedWall(node)) {
    const frame = getWallCurveFrameAt(node, 0.5)
    const offsetNormal = contextualWallDimensionNormal(
      node,
      [frame.normal.x, frame.normal.y],
      ctx.siblings,
    )
    return {
      kind: 'dimension-label',
      appearance: 'outlined',
      cx: frame.point.x + offsetNormal[0] * 0.38,
      cy: frame.point.y + offsetNormal[1] * 0.38,
      text: formatLength(length, ctx),
      angle: Math.atan2(frame.tangent.y, frame.tangent.x),
    }
  }

  const dx = node.end[0] - node.start[0]
  const dy = node.end[1] - node.start[1]
  const chordLength = Math.hypot(dx, dy)
  if (chordLength <= 1e-6) return null
  const front: FloorplanPoint = [-dy / chordLength, dx / chordLength]
  const offsetNormal = contextualWallDimensionNormal(node, front, ctx.siblings)
  if (node.frontSide === 'interior' && node.backSide === 'interior') {
    const span = wallStudFaceSpan(node, ctx.siblings)
    return span.length <= 1e-6 ? null : faceDimension(span, offsetNormal, ctx)
  }

  // `offsetNormal` points out of the wall's exterior (or its best guess at it).
  const exteriorSide = offsetNormal[0] * front[0] + offsetNormal[1] * front[1] > 0 ? 'a' : 'b'
  const interiorNormal: FloorplanPoint = [cleanZero(-offsetNormal[0]), cleanZero(-offsetNormal[1])]
  const faces = readFloorplanContext(ctx).wallDimensionFaces
  const inner = wallFaceSpan(node, exteriorSide === 'a' ? 'b' : 'a', ctx.siblings, 'inner')
  const outer = wallFaceSpan(node, exteriorSide, ctx.siblings, 'outer')
  const interior = faces === 'exterior' ? null : inner
  const exterior = faces === 'interior' ? null : outer
  if (interior && exterior && Math.abs(interior.length - exterior.length) < 0.001) {
    return faceDimension(exterior, offsetNormal, ctx)
  }
  const children = [
    ...(interior ? [faceDimension(interior, interiorNormal, ctx)] : []),
    ...(exterior ? [faceDimension(exterior, offsetNormal, ctx)] : []),
  ]
  if (children.length === 0) return null
  return children.length === 1 ? children[0]! : { kind: 'group', children }
}

export function buildWallHostedOpeningContextualDimensions(
  node: WallHostedOpening,
  ctx: GeometryContext,
  options: OpeningDimensionOptions,
): FloorplanGeometry | null {
  const wall = ctx.parent as WallNode | null
  if (wall?.type !== 'wall' || node.width <= 1e-6) return null
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dy)
  if (wallLength <= 1e-6) return null

  const dirX = dx / wallLength
  const dirY = dy / wallLength
  const cx = wall.start[0] + dirX * node.position[0]
  const cy = wall.start[1] + dirY * node.position[0]
  const halfWidth = node.width / 2
  const openingStart: FloorplanPoint = [cx - dirX * halfWidth, cy - dirY * halfWidth]
  const openingEnd: FloorplanPoint = [cx + dirX * halfWidth, cy + dirY * halfWidth]

  if (!options.useExteriorNormal || isCurvedWall(wall)) {
    return {
      kind: 'dimension',
      start: openingStart,
      end: openingEnd,
      offsetNormal: [-dirY, dirX],
      offsetDistance: 0.34,
      extensionOvershoot: 0.08,
      text: formatLength(node.width, ctx),
      stroke: selectedStroke(ctx),
    }
  }

  const offsetNormal = contextualWallDimensionNormal(wall, [-dirY, dirX], ctx.siblings)
  if (!(options.showClearancesWhileMoving && ctx.viewState?.moving)) {
    return {
      kind: 'dimension',
      start: openingStart,
      end: openingEnd,
      offsetNormal,
      offsetDistance: 0.34,
      extensionOvershoot: 0.08,
      text: formatLength(node.width, ctx),
      stroke: selectedStroke(ctx),
    }
  }

  const span = wallStudFaceSpan(wall, ctx.siblings)
  const spanStart = (span.start[0] - wall.start[0]) * dirX + (span.start[1] - wall.start[1]) * dirY
  const spanEnd = (span.end[0] - wall.start[0]) * dirX + (span.end[1] - wall.start[1]) * dirY
  const openingStartAlong = node.position[0] - halfWidth
  const openingEndAlong = node.position[0] + halfWidth

  return {
    kind: 'dimension-string',
    segments: [
      {
        start: span.start,
        end: openingStart,
        text: formatLength(Math.max(0, openingStartAlong - spanStart), ctx),
      },
      {
        start: openingStart,
        end: openingEnd,
        text: formatLength(node.width, ctx),
      },
      {
        start: openingEnd,
        end: span.end,
        text: formatLength(Math.max(0, spanEnd - openingEndAlong), ctx),
      },
    ],
    offsetNormal,
    offsetDistance: 0.34,
    extensionOvershoot: 0.08,
    stroke: selectedStroke(ctx),
  }
}
