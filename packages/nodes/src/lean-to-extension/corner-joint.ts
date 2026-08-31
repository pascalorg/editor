import { type AnyNode, type LeanToExtensionNode, unionPolygons, WallNode } from '@pascal-app/core'
import { bendLocalPoint, isCurvedLeanTo, leanToArcFrameAtLocalX } from './arc'
import { resolveFreestandingCanopyJoints } from './canopy-joint'
import { leanToWallLocalPose, resolveLeanToLayout } from './layout'
import { applyLeanToWallCornerSpan } from './roof-attachment'

export type LeanToCornerSide = 'left' | 'right'
export type LeanToPlanPoint = [number, number]
export type LeanToCornerKind = 'convex' | 'concave' | 'linear'
export type LeanToFramingRetainedSide = 'front' | 'back'

export type LeanToCornerJoint = {
  side: LeanToCornerSide
  kind: LeanToCornerKind
  neighborId: string
  neighborSide: LeanToCornerSide
  roofExtension: number
  roofPiece: LeanToPlanPoint[]
  roofPieces?: LeanToPlanPoint[][]
  roofAdditionPieces?: LeanToPlanPoint[][]
  mergeRoofPieces?: boolean
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null
  framingRetainedSide?: LeanToFramingRetainedSide
  beamExtension: number
  gutterMitre: number
  sharedPostOwner: boolean
  sharedPostPosition: [number, number, number]
}

export const LEAN_TO_CORNER_JOINTS_KEY = 'leanToCornerJoints'

const WALL_CONNECTION_OVERLAP = 0.02
const WALL_CONNECTION_TRIM = 0.002
const PLAN_TOLERANCE = 1e-6
const MIN_NON_COLLINEAR_ANGLE = 1e-4
const LINEAR_DIRECTION_TOLERANCE = 1e-6
const LINEAR_JOIN_PLAN_TOLERANCE = 0.03
const FREESTANDING_JOINT_WALL_THICKNESS = 0.1
const LINEAR_JOIN_HEIGHT_TOLERANCE = 0.02

function planDistance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function directionsFormSupportedCorner(
  away: LeanToPlanPoint | null,
  candidateAway: LeanToPlanPoint | null,
): boolean {
  if (!(away && candidateAway)) return false
  const dot = Math.max(-1, Math.min(1, away[0] * candidateAway[0] + away[1] * candidateAway[1]))
  const angle = Math.acos(dot)
  return angle > MIN_NON_COLLINEAR_ANGLE && angle < Math.PI - MIN_NON_COLLINEAR_ANGLE
}

function wallFrame(wall: WallNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length <= PLAN_TOLERANCE) return null
  return {
    along: [dx / length, dz / length] as const,
    perpendicular: [-dz / length, dx / length] as const,
    start: [wall.start[0], wall.start[1]] as const,
  }
}

type LeanToJointFrame = {
  kind: 'wall' | 'freestanding'
  leanTo: LeanToExtensionNode
  wall: WallNode
}

function resolveLeanToJointFrame(
  leanTo: LeanToExtensionNode,
  wall: WallNode | undefined,
): LeanToJointFrame | null {
  if (wall) return { kind: 'wall', leanTo, wall }
  if (!(leanTo.hostKind === 'freestanding' && leanTo.canopyForm === 'mono' && leanTo.parentId)) {
    return null
  }
  const halfSpan = leanTo.span / 2
  const cos = Math.cos(leanTo.rotation[1])
  const sin = Math.sin(leanTo.rotation[1])
  const surfaceOffset = FREESTANDING_JOINT_WALL_THICKNESS / 2
  const syntheticWall = WallNode.parse({
    name: 'Freestanding canopy run frame',
    parentId: leanTo.parentId,
    start: [
      leanTo.position[0] - halfSpan * cos - surfaceOffset * sin,
      leanTo.position[2] + halfSpan * sin - surfaceOffset * cos,
    ],
    end: [
      leanTo.position[0] + halfSpan * cos - surfaceOffset * sin,
      leanTo.position[2] - halfSpan * sin - surfaceOffset * cos,
    ],
    height: leanTo.highEdgeHeight,
    thickness: FREESTANDING_JOINT_WALL_THICKNESS,
  })
  return {
    kind: 'freestanding',
    wall: syntheticWall,
    leanTo: {
      ...leanTo,
      parentId: syntheticWall.id,
      position: [halfSpan, leanTo.position[1], surfaceOffset],
      rotation: [0, 0, 0],
      spanArcCenterZ: undefined,
      spanArcRadius: undefined,
    },
  }
}

function leanToOutwardDirection(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
): LeanToPlanPoint | null {
  const layout = resolveLeanToLayout(leanTo)
  const x = layout.roofCenterX + (side === 'left' ? -layout.roofWidth / 2 : layout.roofWidth / 2)
  const frame = leanToArcFrameAtLocalX(leanTo, x)
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  return [frame.normal.x * cos + frame.normal.y * sin, -frame.normal.x * sin + frame.normal.y * cos]
}

function awayFromEndDirection(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
): LeanToPlanPoint | null {
  const layout = resolveLeanToLayout(leanTo)
  const endpointX =
    layout.roofCenterX + (side === 'left' ? -layout.roofWidth / 2 : layout.roofWidth / 2)
  const frame = leanToArcFrameAtLocalX(leanTo, endpointX)
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  const inwardSign = side === 'left' ? 1 : -1
  return [
    (frame.tangent.x * cos + frame.tangent.y * sin) * inwardSign,
    (-frame.tangent.x * sin + frame.tangent.y * cos) * inwardSign,
  ]
}

function awayFromEndChordDirection(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
): LeanToPlanPoint | null {
  const endpoint = endWorldPoint(wall, leanTo, side)
  const opposite = endWorldPoint(wall, leanTo, side === 'left' ? 'right' : 'left')
  if (!(endpoint && opposite)) return null
  const dx = opposite[0] - endpoint[0]
  const dz = opposite[1] - endpoint[1]
  const length = Math.hypot(dx, dz)
  return length > PLAN_TOLERANCE ? [dx / length, dz / length] : null
}

function cornerKindFromDirections(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
): LeanToCornerKind | null {
  const outward = leanToOutwardDirection(wall, leanTo, side)
  const candidateOutward = leanToOutwardDirection(candidateWall, candidate, candidateSide)
  const away = awayFromEndDirection(wall, leanTo, side)
  const candidateAway = awayFromEndDirection(candidateWall, candidate, candidateSide)
  if (!(outward && candidateOutward && away && candidateAway)) return null
  const candidateAcrossOwn = outward[0] * candidateAway[0] + outward[1] * candidateAway[1]
  const ownAcrossCandidate = candidateOutward[0] * away[0] + candidateOutward[1] * away[1]
  const outwardDot = outward[0] * candidateOutward[0] + outward[1] * candidateOutward[1]
  const awayDot = away[0] * candidateAway[0] + away[1] * candidateAway[1]
  if (outwardDot >= 1 - LINEAR_DIRECTION_TOLERANCE && awayDot <= -1 + LINEAR_DIRECTION_TOLERANCE) {
    return 'linear'
  }
  if (candidateAcrossOwn < -PLAN_TOLERANCE && ownAcrossCandidate < -PLAN_TOLERANCE) {
    return 'convex'
  }
  if (candidateAcrossOwn > PLAN_TOLERANCE && ownAcrossCandidate > PLAN_TOLERANCE) {
    return 'concave'
  }
  return null
}

function roofEndWorldPoint(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
): LeanToPlanPoint | null {
  const layout = resolveLeanToLayout(leanTo)
  const sign = side === 'left' ? -1 : 1
  return leanToPointToWorld(wall, leanTo, layout.roofCenterX + sign * (layout.roofWidth / 2), 0)
}

function candidateRoofSideAtPoint(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  point: readonly [number, number],
): LeanToCornerSide | null {
  const left = roofEndWorldPoint(wall, leanTo, 'left')
  const right = roofEndWorldPoint(wall, leanTo, 'right')
  if (left && planDistance(left, point) <= LINEAR_JOIN_PLAN_TOLERANCE) return 'left'
  if (right && planDistance(right, point) <= LINEAR_JOIN_PLAN_TOLERANCE) return 'right'
  return null
}

function resolveLinearJoint(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
): Pick<LeanToCornerJoint, 'roofPiece' | 'seam' | 'beamExtension' | 'sharedPostPosition'> | null {
  const layout = resolveLeanToLayout(leanTo)
  const candidateLayout = resolveLeanToLayout(candidate)
  const sign = side === 'left' ? -1 : 1
  const candidateSign = candidateSide === 'left' ? -1 : 1
  const sideX = layout.roofCenterX + sign * (layout.roofWidth / 2)
  const candidateSideX =
    candidateLayout.roofCenterX + candidateSign * (candidateLayout.roofWidth / 2)
  const edges = roofPlanEdges(leanTo)
  const candidateEdges = roofPlanEdges(candidate)
  const ownBack = leanToPointToWorld(wall, leanTo, sideX, edges.back)
  const ownFront = leanToPointToWorld(wall, leanTo, sideX, edges.front)
  const candidateBack = leanToPointToWorld(
    candidateWall,
    candidate,
    candidateSideX,
    candidateEdges.back,
  )
  const candidateFront = leanToPointToWorld(
    candidateWall,
    candidate,
    candidateSideX,
    candidateEdges.front,
  )
  if (!(ownBack && ownFront && candidateBack && candidateFront)) return null
  if (
    planDistance(ownBack, candidateBack) > LINEAR_JOIN_PLAN_TOLERANCE ||
    planDistance(ownFront, candidateFront) > LINEAR_JOIN_PLAN_TOLERANCE
  ) {
    return null
  }

  for (const point of [ownBack, ownFront] as const) {
    const ownHeight = leanToTopHeightAtWorld(wall, leanTo, point)
    const candidateHeight = leanToTopHeightAtWorld(candidateWall, candidate, point)
    if (
      ownHeight === null ||
      candidateHeight === null ||
      Math.abs(ownHeight - candidateHeight) > LINEAR_JOIN_HEIGHT_TOLERANCE
    ) {
      return null
    }
  }

  const ownBeam = leanToPointToWorld(wall, leanTo, sideX, layout.beamZ)
  const candidateBeam = leanToPointToWorld(
    candidateWall,
    candidate,
    candidateSideX,
    candidateLayout.beamZ,
  )
  if (!(ownBeam && candidateBeam)) return null
  if (planDistance(ownBeam, candidateBeam) > LINEAR_JOIN_PLAN_TOLERANCE) return null

  const structuralSideX = sign * (layout.span / 2)
  const beamExtension = Math.max(0, sign * (sideX - structuralSideX))
  return {
    roofPiece: [],
    seam: [
      [sideX, edges.back],
      [sideX, edges.front],
    ],
    beamExtension,
    sharedPostPosition: [sideX, 0, layout.beamZ],
  }
}

function cornerInteriorAngle(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
): number | null {
  const away = awayFromEndDirection(wall, leanTo, side)
  const candidateAway = awayFromEndDirection(candidateWall, candidate, candidateSide)
  if (!(away && candidateAway)) return null
  const dot = Math.max(-1, Math.min(1, away[0] * candidateAway[0] + away[1] * candidateAway[1]))
  return Math.acos(dot)
}

function isSupportedHostCorner(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
): boolean {
  if (
    directionsFormSupportedCorner(
      awayFromEndDirection(wall, leanTo, side),
      awayFromEndDirection(candidateWall, candidate, candidateSide),
    )
  ) {
    return true
  }
  return directionsFormSupportedCorner(
    awayFromEndChordDirection(wall, leanTo, side),
    awayFromEndChordDirection(candidateWall, candidate, candidateSide),
  )
}

function leanToPointToWorld(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  localX: number,
  localZ: number,
): LeanToPlanPoint | null {
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  const point = bendLocalPoint(leanTo, localX, localZ)
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  return [
    pose.position[0] + point.x * cos + point.y * sin,
    pose.position[2] - point.x * sin + point.y * cos,
  ]
}

function worldPointToLeanTo(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  point: readonly [number, number],
): LeanToPlanPoint | null {
  const pose = leanToWallLocalPose(wall, leanTo, 0)
  const dx = point[0] - pose.position[0]
  const dz = point[1] - pose.position[2]
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  const bentX = dx * cos - dz * sin
  const bentZ = dx * sin + dz * cos
  if (!isCurvedLeanTo(leanTo)) return [bentX, bentZ]
  const centerZ = leanTo.spanArcCenterZ as number
  const radialSign = -(Math.sign(centerZ) || 1)
  const radial = Math.hypot(bentX, bentZ - centerZ) * radialSign
  const phi = Math.atan2(-bentX * radialSign, (bentZ - centerZ) * radialSign)
  const signedRadius = (Math.sign(centerZ) || 1) * (leanTo.spanArcRadius as number)
  return [phi * signedRadius, centerZ + radial]
}

function extensionToRunIntersection(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  ownSideX: number,
  ownZ: number,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateZ: number,
): number | null {
  const ownOrigin = leanToPointToWorld(wall, leanTo, 0, ownZ)
  const ownNext = leanToPointToWorld(wall, leanTo, 1, ownZ)
  const ownBoundary = leanToPointToWorld(wall, leanTo, ownSideX, ownZ)
  const candidateOrigin = leanToPointToWorld(candidateWall, candidate, 0, candidateZ)
  const candidateNext = leanToPointToWorld(candidateWall, candidate, 1, candidateZ)
  if (!(ownOrigin && ownNext && ownBoundary && candidateOrigin && candidateNext)) return null

  const ownDirection: LeanToPlanPoint = [ownNext[0] - ownOrigin[0], ownNext[1] - ownOrigin[1]]
  const sideSign = side === 'left' ? -1 : 1
  if (isCurvedLeanTo(leanTo) && !isCurvedLeanTo(candidate)) {
    const candidateDirection: LeanToPlanPoint = [
      candidateNext[0] - candidateOrigin[0],
      candidateNext[1] - candidateOrigin[1],
    ]
    const directionLength = Math.hypot(candidateDirection[0], candidateDirection[1])
    if (directionLength <= PLAN_TOLERANCE) return null
    const direction: LeanToPlanPoint = [
      candidateDirection[0] / directionLength,
      candidateDirection[1] / directionLength,
    ]
    const pose = leanToWallLocalPose(wall, leanTo, 0)
    const centerZ = leanTo.spanArcCenterZ as number
    const cos = Math.cos(pose.rotationY)
    const sin = Math.sin(pose.rotationY)
    const center: LeanToPlanPoint = [
      pose.position[0] + centerZ * sin,
      pose.position[2] + centerZ * cos,
    ]
    const offset: LeanToPlanPoint = [candidateOrigin[0] - center[0], candidateOrigin[1] - center[1]]
    const projection = offset[0] * direction[0] + offset[1] * direction[1]
    const radius = Math.abs(ownZ - centerZ)
    const discriminant =
      projection * projection - (offset[0] * offset[0] + offset[1] * offset[1] - radius * radius)
    if (discriminant < -PLAN_TOLERANCE) return null
    const root = Math.sqrt(Math.max(0, discriminant))
    const extensions = [-projection - root, -projection + root].flatMap((distance) => {
      const intersection: LeanToPlanPoint = [
        candidateOrigin[0] + direction[0] * distance,
        candidateOrigin[1] + direction[1] * distance,
      ]
      const local = worldPointToLeanTo(wall, leanTo, intersection)
      if (!local) return []
      const extension = sideSign * (local[0] - ownSideX)
      return extension >= -PLAN_TOLERANCE ? [Math.max(0, extension)] : []
    })
    return extensions.length > 0 ? Math.min(...extensions) : null
  }
  if (isCurvedLeanTo(candidate) && !isCurvedLeanTo(leanTo)) {
    const directionLength = Math.hypot(ownDirection[0], ownDirection[1])
    if (directionLength <= PLAN_TOLERANCE) return null
    const direction: LeanToPlanPoint = [
      (ownDirection[0] / directionLength) * sideSign,
      (ownDirection[1] / directionLength) * sideSign,
    ]
    const pose = leanToWallLocalPose(candidateWall, candidate, 0)
    const centerZ = candidate.spanArcCenterZ as number
    const cos = Math.cos(pose.rotationY)
    const sin = Math.sin(pose.rotationY)
    const center: LeanToPlanPoint = [
      pose.position[0] + centerZ * sin,
      pose.position[2] + centerZ * cos,
    ]
    const offset: LeanToPlanPoint = [ownBoundary[0] - center[0], ownBoundary[1] - center[1]]
    const projection = offset[0] * direction[0] + offset[1] * direction[1]
    const radius = Math.abs(candidateZ - centerZ)
    const discriminant =
      projection * projection - (offset[0] * offset[0] + offset[1] * offset[1] - radius * radius)
    if (discriminant < -PLAN_TOLERANCE) return null
    const root = Math.sqrt(Math.max(0, discriminant))
    const intersections = [-projection - root, -projection + root].filter(
      (distance) => distance >= -PLAN_TOLERANCE,
    )
    return intersections.length > 0 ? Math.max(0, Math.min(...intersections)) : null
  }
  const candidateDirection: LeanToPlanPoint = [
    candidateNext[0] - candidateOrigin[0],
    candidateNext[1] - candidateOrigin[1],
  ]
  const cross = ownDirection[0] * candidateDirection[1] - ownDirection[1] * candidateDirection[0]
  if (Math.abs(cross) <= PLAN_TOLERANCE) return null
  const deltaX = candidateOrigin[0] - ownOrigin[0]
  const deltaZ = candidateOrigin[1] - ownOrigin[1]
  const alongOwn = (deltaX * candidateDirection[1] - deltaZ * candidateDirection[0]) / cross
  const intersection: LeanToPlanPoint = [
    ownOrigin[0] + ownDirection[0] * alongOwn,
    ownOrigin[1] + ownDirection[1] * alongOwn,
  ]
  return (
    sideSign *
    ((intersection[0] - ownBoundary[0]) * ownDirection[0] +
      (intersection[1] - ownBoundary[1]) * ownDirection[1])
  )
}

function leanToTopHeightAtWorld(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  point: readonly [number, number],
): number | null {
  const local = worldPointToLeanTo(wall, leanTo, point)
  if (!local) return null
  const layout = resolveLeanToLayout(leanTo)
  return leanTo.position[1] + layout.highEdgeHeight - local[1] * Math.tan(layout.pitchRadians)
}

function roofPlanEdges(leanTo: LeanToExtensionNode): {
  back: number
  front: number
} {
  const layout = resolveLeanToLayout(leanTo)
  const depth = layout.roofRun + WALL_CONNECTION_OVERLAP
  const centerZ =
    depth / 2 - Math.max(0, leanTo.highOverhang) - WALL_CONNECTION_TRIM - WALL_CONNECTION_OVERLAP
  return {
    back: centerZ - depth / 2 + (leanTo.highOverhang > 0 ? 0 : WALL_CONNECTION_TRIM),
    front: centerZ + depth / 2,
  }
}

function gutterAwayFromJointDirection(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  extension: number,
): LeanToPlanPoint | null {
  if (Math.abs(extension) <= PLAN_TOLERANCE) return awayFromEndDirection(wall, leanTo, side)
  const layout = resolveLeanToLayout(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const baseX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
  const front = roofPlanEdges(leanTo).front
  const base = leanToPointToWorld(wall, leanTo, baseX, front)
  const end = leanToPointToWorld(wall, leanTo, baseX + sideSign * extension, front)
  if (!(base && end)) return null
  const dx = base[0] - end[0]
  const dz = base[1] - end[1]
  const length = Math.hypot(dx, dz)
  return length > PLAN_TOLERANCE ? [dx / length, dz / length] : null
}

function endWorldPoint(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
): LeanToPlanPoint | null {
  const layout = resolveLeanToLayout(leanTo)
  const x = side === 'left' ? -layout.span / 2 : layout.span / 2
  return leanToPointToWorld(wall, leanTo, x, 0)
}

function candidateSideAtPoint(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  point: readonly [number, number],
  tolerance: number,
): LeanToCornerSide | null {
  const left = endWorldPoint(wall, leanTo, 'left')
  const right = endWorldPoint(wall, leanTo, 'right')
  if (left && planDistance(left, point) <= tolerance) return 'left'
  if (right && planDistance(right, point) <= tolerance) return 'right'
  return null
}

function clipToRetainedRoofSide(
  polygon: readonly LeanToPlanPoint[],
  heightDelta: (point: readonly [number, number]) => number | null,
  retainedSign: number,
): LeanToPlanPoint[] {
  const clipped: LeanToPlanPoint[] = []
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentDelta = heightDelta(current)
    const nextDelta = heightDelta(next)
    if (currentDelta === null || nextDelta === null) return []
    const currentInside = currentDelta * retainedSign >= -PLAN_TOLERANCE
    const nextInside = nextDelta * retainedSign >= -PLAN_TOLERANCE
    if (currentInside) clipped.push([current[0], current[1]])
    if (currentInside === nextInside) continue
    const ratio = currentDelta / (currentDelta - nextDelta)
    clipped.push([
      current[0] + (next[0] - current[0]) * ratio,
      current[1] + (next[1] - current[1]) * ratio,
    ])
  }
  return clipped.filter(
    (point, index) => index === 0 || planDistance(point, clipped[index - 1]!) > PLAN_TOLERANCE,
  )
}

function roofExtensionBand(
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  extension: number,
): LeanToPlanPoint[] {
  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const originalSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
  const extendedSideX = originalSideX + sideSign * extension
  return [
    [originalSideX, edges.back],
    [extendedSideX, edges.back],
    [extendedSideX, edges.front],
    [originalSideX, edges.front],
  ]
}

function roofBasePolygon(leanTo: LeanToExtensionNode): LeanToPlanPoint[] {
  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  return [
    [layout.roofCenterX - layout.roofWidth / 2, edges.back],
    [layout.roofCenterX + layout.roofWidth / 2, edges.back],
    [layout.roofCenterX + layout.roofWidth / 2, edges.front],
    [layout.roofCenterX - layout.roofWidth / 2, edges.front],
  ]
}

function polygonSignedArea(polygon: readonly LeanToPlanPoint[]): number {
  let area = 0
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function pointInPlanPolygon(
  point: readonly [number, number],
  polygon: readonly LeanToPlanPoint[],
): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!
    const prior = polygon[previous]!
    const edgeX = current[0] - prior[0]
    const edgeZ = current[1] - prior[1]
    const cross = (point[0] - prior[0]) * edgeZ - (point[1] - prior[1]) * edgeX
    const dot =
      (point[0] - prior[0]) * (point[0] - current[0]) +
      (point[1] - prior[1]) * (point[1] - current[1])
    if (Math.abs(cross) <= PLAN_TOLERANCE && dot <= PLAN_TOLERANCE) return true
    if (
      current[1] > point[1] !== prior[1] > point[1] &&
      point[0] <
        ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]
    ) {
      inside = !inside
    }
  }
  return inside
}

function resolveFramingRetainedSide(
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null,
  pieces: readonly LeanToPlanPoint[][],
): LeanToFramingRetainedSide | undefined {
  if (!seam || pieces.length === 0) return undefined
  const midpoint: LeanToPlanPoint = [(seam[0][0] + seam[1][0]) / 2, (seam[0][1] + seam[1][1]) / 2]
  const probeDistance = 0.01
  const contains = (point: LeanToPlanPoint) =>
    pieces.some((polygon) => pointInPlanPolygon(point, polygon))
  const front = contains([midpoint[0], midpoint[1] + probeDistance])
  const back = contains([midpoint[0], midpoint[1] - probeDistance])
  if (front === back) return undefined
  return front ? 'front' : 'back'
}

function connectedPlanPolygonComponent(
  polygons: LeanToPlanPoint[][],
  probe: readonly [number, number],
): LeanToPlanPoint[][] {
  const connected = new Set<number>()
  const queue = polygons.flatMap((polygon, index) =>
    pointInPlanPolygon(probe, polygon) ? [index] : [],
  )
  for (const index of queue) connected.add(index)

  while (queue.length > 0) {
    const currentIndex = queue.shift()!
    const current = polygons[currentIndex]!
    for (let candidateIndex = 0; candidateIndex < polygons.length; candidateIndex++) {
      if (connected.has(candidateIndex)) continue
      const candidate = polygons[candidateIndex]!
      const touches =
        current.some((point) => pointInPlanPolygon(point, candidate)) ||
        candidate.some((point) => pointInPlanPolygon(point, current))
      if (!touches) continue
      connected.add(candidateIndex)
      queue.push(candidateIndex)
    }
  }

  return polygons.filter((_, index) => connected.has(index))
}

function planSegmentsShareLength(
  leftStart: LeanToPlanPoint,
  leftEnd: LeanToPlanPoint,
  rightStart: LeanToPlanPoint,
  rightEnd: LeanToPlanPoint,
): boolean {
  const leftX = leftEnd[0] - leftStart[0]
  const leftZ = leftEnd[1] - leftStart[1]
  const leftLength = Math.hypot(leftX, leftZ)
  if (leftLength <= PLAN_TOLERANCE) return false
  const cross = (x: number, z: number) => leftX * z - leftZ * x
  if (
    Math.abs(cross(rightStart[0] - leftStart[0], rightStart[1] - leftStart[1])) >
      PLAN_TOLERANCE * leftLength ||
    Math.abs(cross(rightEnd[0] - leftStart[0], rightEnd[1] - leftStart[1])) >
      PLAN_TOLERANCE * leftLength
  ) {
    return false
  }

  const project = (point: LeanToPlanPoint) =>
    ((point[0] - leftStart[0]) * leftX + (point[1] - leftStart[1]) * leftZ) / leftLength
  const rightStartDistance = project(rightStart)
  const rightEndDistance = project(rightEnd)
  const overlapStart = Math.max(0, Math.min(rightStartDistance, rightEndDistance))
  const overlapEnd = Math.min(leftLength, Math.max(rightStartDistance, rightEndDistance))
  return overlapEnd - overlapStart > PLAN_TOLERANCE
}

function polygonsSharePlanEdge(left: LeanToPlanPoint[], right: LeanToPlanPoint[]): boolean {
  return left.some((leftStart, leftIndex) => {
    const leftEnd = left[(leftIndex + 1) % left.length]!
    return right.some((rightStart, rightIndex) =>
      planSegmentsShareLength(
        leftStart,
        leftEnd,
        rightStart,
        right[(rightIndex + 1) % right.length]!,
      ),
    )
  })
}

function edgeConnectedPlanPolygonComponent(
  polygons: LeanToPlanPoint[][],
  anchor: LeanToPlanPoint[],
): LeanToPlanPoint[][] {
  return edgeConnectedPlanPolygonComponents(polygons, [anchor])
}

function edgeConnectedPlanPolygonComponents(
  polygons: LeanToPlanPoint[][],
  anchors: LeanToPlanPoint[][],
): LeanToPlanPoint[][] {
  const connected = new Set<number>()
  const queue = polygons.flatMap((polygon, index) =>
    anchors.some((anchor) => polygonsSharePlanEdge(anchor, polygon)) ? [index] : [],
  )
  for (const index of queue) connected.add(index)

  while (queue.length > 0) {
    const currentIndex = queue.shift()!
    for (let candidateIndex = 0; candidateIndex < polygons.length; candidateIndex++) {
      if (
        connected.has(candidateIndex) ||
        !polygonsSharePlanEdge(polygons[currentIndex]!, polygons[candidateIndex]!)
      ) {
        continue
      }
      connected.add(candidateIndex)
      queue.push(candidateIndex)
    }
  }

  return polygons.filter((_, index) => connected.has(index))
}

function intersectConvexPolygons(
  subject: readonly LeanToPlanPoint[],
  clip: readonly LeanToPlanPoint[],
): LeanToPlanPoint[] {
  let result = subject.map((point) => [point[0], point[1]] as LeanToPlanPoint)
  const orientation = Math.sign(polygonSignedArea(clip)) || 1
  for (let clipIndex = 0; clipIndex < clip.length && result.length > 0; clipIndex++) {
    const edgeStart = clip[clipIndex]!
    const edgeEnd = clip[(clipIndex + 1) % clip.length]!
    const input = result
    result = []
    const edgeSide = (point: readonly [number, number]) =>
      orientation *
      ((edgeEnd[0] - edgeStart[0]) * (point[1] - edgeStart[1]) -
        (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]))
    for (let index = 0; index < input.length; index++) {
      const current = input[index]!
      const next = input[(index + 1) % input.length]!
      const currentSide = edgeSide(current)
      const nextSide = edgeSide(next)
      const currentInside = currentSide >= -PLAN_TOLERANCE
      const nextInside = nextSide >= -PLAN_TOLERANCE
      if (currentInside) result.push(current)
      if (currentInside === nextInside) continue
      const ratio = currentSide / (currentSide - nextSide)
      result.push([
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ])
    }
  }
  return result
}

function clipPolygonToHalfPlane(
  polygon: readonly LeanToPlanPoint[],
  edgeStart: LeanToPlanPoint,
  edgeEnd: LeanToPlanPoint,
  orientation: number,
  keepInside: boolean,
): LeanToPlanPoint[] {
  const clipped: LeanToPlanPoint[] = []
  const edgeSide = (point: readonly [number, number]) =>
    orientation *
    ((edgeEnd[0] - edgeStart[0]) * (point[1] - edgeStart[1]) -
      (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]))
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentSide = edgeSide(current)
    const nextSide = edgeSide(next)
    const currentInside = keepInside
      ? currentSide >= -PLAN_TOLERANCE
      : currentSide <= PLAN_TOLERANCE
    const nextInside = keepInside ? nextSide >= -PLAN_TOLERANCE : nextSide <= PLAN_TOLERANCE
    if (currentInside) clipped.push([current[0], current[1]])
    if (currentInside === nextInside) continue
    const ratio = currentSide / (currentSide - nextSide)
    clipped.push([
      current[0] + (next[0] - current[0]) * ratio,
      current[1] + (next[1] - current[1]) * ratio,
    ])
  }
  return clipped.filter(
    (point, index) => index === 0 || planDistance(point, clipped[index - 1]!) > PLAN_TOLERANCE,
  )
}

function subtractConvexPolygon(
  subject: readonly LeanToPlanPoint[],
  clip: readonly LeanToPlanPoint[],
): LeanToPlanPoint[][] {
  if (subject.length < 3) return []
  if (clip.length < 3) return [subject.map((point) => [point[0], point[1]])]
  const orientation = Math.sign(polygonSignedArea(clip)) || 1
  let remaining = subject.map((point) => [point[0], point[1]] as LeanToPlanPoint)
  const outside: LeanToPlanPoint[][] = []
  for (let index = 0; index < clip.length && remaining.length >= 3; index++) {
    const edgeStart = clip[index]!
    const edgeEnd = clip[(index + 1) % clip.length]!
    const fragment = clipPolygonToHalfPlane(remaining, edgeStart, edgeEnd, orientation, false)
    if (fragment.length >= 3 && Math.abs(polygonSignedArea(fragment)) > PLAN_TOLERANCE) {
      outside.push(fragment)
    }
    remaining = clipPolygonToHalfPlane(remaining, edgeStart, edgeEnd, orientation, true)
  }
  return outside
}

function roofWorldFacets(wall: WallNode, leanTo: LeanToExtensionNode): LeanToPlanPoint[][] {
  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  const facetCount = isCurvedLeanTo(leanTo)
    ? Math.max(4, Math.min(32, Math.ceil(layout.roofWidth / 0.4)))
    : 1
  const leftX = layout.roofCenterX - layout.roofWidth / 2
  const facetWidth = layout.roofWidth / facetCount
  return Array.from({ length: facetCount }, (_, index) => {
    const minX = leftX + index * facetWidth
    const maxX = index === facetCount - 1 ? leftX + layout.roofWidth : minX + facetWidth
    return [
      leanToPointToWorld(wall, leanTo, minX, edges.back),
      leanToPointToWorld(wall, leanTo, maxX, edges.back),
      leanToPointToWorld(wall, leanTo, maxX, edges.front),
      leanToPointToWorld(wall, leanTo, minX, edges.front),
    ].flatMap((point) => (point ? [point] : []))
  }).filter((polygon) => polygon.length >= 3)
}

function sharedRoofSeam(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  extension: number,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
  candidateExtension: number,
  kind: LeanToCornerKind,
): [LeanToPlanPoint, LeanToPlanPoint] | null {
  const ownPolygon =
    kind === 'convex' ? roofExtensionBand(leanTo, side, extension) : roofBasePolygon(leanTo)
  const ownBand = ownPolygon.flatMap((point) => {
    const world = leanToPointToWorld(wall, leanTo, point[0], point[1])
    return world ? [world] : []
  })
  const candidatePolygon =
    kind === 'convex'
      ? roofExtensionBand(candidate, candidateSide, candidateExtension)
      : roofBasePolygon(candidate)
  const candidateBand = candidatePolygon.flatMap((point) => {
    const world = leanToPointToWorld(candidateWall, candidate, point[0], point[1])
    return world ? [world] : []
  })
  if (ownBand.length < 3 || candidateBand.length < 3) return null
  const overlap = intersectConvexPolygons(ownBand, candidateBand)
  const seamWorld: LeanToPlanPoint[] = []
  const heightDelta = (point: readonly [number, number]) => {
    const ownHeight = leanToTopHeightAtWorld(wall, leanTo, point)
    const candidateHeight = leanToTopHeightAtWorld(candidateWall, candidate, point)
    return ownHeight === null || candidateHeight === null ? null : ownHeight - candidateHeight
  }
  for (let index = 0; index < overlap.length; index++) {
    const current = overlap[index]!
    const next = overlap[(index + 1) % overlap.length]!
    const currentDelta = heightDelta(current)
    const nextDelta = heightDelta(next)
    if (currentDelta === null || nextDelta === null) return null
    if (Math.abs(currentDelta) <= PLAN_TOLERANCE) seamWorld.push(current)
    if (currentDelta * nextDelta >= 0) continue
    const ratio = currentDelta / (currentDelta - nextDelta)
    seamWorld.push([
      current[0] + (next[0] - current[0]) * ratio,
      current[1] + (next[1] - current[1]) * ratio,
    ])
  }
  const unique = seamWorld.filter(
    (point, index) =>
      seamWorld.findIndex(
        (candidatePoint) => planDistance(point, candidatePoint) <= PLAN_TOLERANCE,
      ) === index,
  )
  if (unique.length < 2) return null
  let endpoints: [LeanToPlanPoint, LeanToPlanPoint] = [unique[0]!, unique[1]!]
  for (const first of unique) {
    for (const second of unique) {
      if (planDistance(first, second) > planDistance(endpoints[0], endpoints[1])) {
        endpoints = [first, second]
      }
    }
  }
  const localized = endpoints.map((point) => worldPointToLeanTo(wall, leanTo, point))
  return localized[0] && localized[1] ? [localized[0], localized[1]] : null
}

function resolveConcaveRoofPiece(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  side: LeanToCornerSide,
  candidate: LeanToExtensionNode,
  candidateWall: WallNode,
): {
  piece: LeanToPlanPoint[]
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null
} {
  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const originalSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
  const heightDelta = (point: readonly [number, number]): number | null => {
    const worldPoint = leanToPointToWorld(wall, leanTo, point[0], point[1])
    if (!worldPoint) return null
    const ownHeight = leanToTopHeightAtWorld(wall, leanTo, worldPoint)
    const candidateHeight = leanToTopHeightAtWorld(candidateWall, candidate, worldPoint)
    return ownHeight === null || candidateHeight === null ? null : ownHeight - candidateHeight
  }
  const probeDelta = heightDelta([
    originalSideX - sideSign * Math.min(0.1, layout.roofWidth / 4),
    edges.back,
  ])
  if (probeDelta === null || Math.abs(probeDelta) <= PLAN_TOLERANCE) {
    return { piece: [], seam: null }
  }
  const base = roofBasePolygon(leanTo)
  const piece = clipToRetainedRoofSide(base, heightDelta, Math.sign(probeDelta))
  const seamPoints: LeanToPlanPoint[] = []
  for (let index = 0; index < base.length; index++) {
    const current = base[index]!
    const next = base[(index + 1) % base.length]!
    const currentDelta = heightDelta(current)
    const nextDelta = heightDelta(next)
    if (currentDelta === null || nextDelta === null) continue
    if (Math.abs(currentDelta) <= PLAN_TOLERANCE) seamPoints.push(current)
    if (currentDelta * nextDelta >= 0) continue
    const ratio = currentDelta / (currentDelta - nextDelta)
    seamPoints.push([
      current[0] + (next[0] - current[0]) * ratio,
      current[1] + (next[1] - current[1]) * ratio,
    ])
  }
  const uniqueSeam = seamPoints.filter(
    (point, index) =>
      seamPoints.findIndex((other) => planDistance(point, other) <= PLAN_TOLERANCE) === index,
  )
  return {
    piece,
    seam: uniqueSeam.length >= 2 ? [uniqueSeam[0]!, uniqueSeam[1]!] : null,
  }
}

function resolveCurvedStraightConcaveRoofPiece(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  side: LeanToCornerSide,
  candidate: LeanToExtensionNode,
  candidateWall: WallNode,
  candidateSide: LeanToCornerSide,
): {
  piece: LeanToPlanPoint[]
  pieces: LeanToPlanPoint[][]
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null
} | null {
  const ownCurved = isCurvedLeanTo(leanTo)
  const candidateCurved = isCurvedLeanTo(candidate)
  if (ownCurved === candidateCurved) return null
  const curved = ownCurved ? leanTo : candidate
  const curvedWall = ownCurved ? wall : candidateWall
  const curvedSide = ownCurved ? side : candidateSide
  const straight = ownCurved ? candidate : leanTo
  const straightWall = ownCurved ? candidateWall : wall
  const curvedLayout = resolveLeanToLayout(curved)

  const curvedEdges = roofPlanEdges(curved)
  const curvedSideSign = curvedSide === 'left' ? -1 : 1
  const curvedSideX = curvedLayout.roofCenterX + curvedSideSign * (curvedLayout.roofWidth / 2)
  const probeWorld = leanToPointToWorld(
    curvedWall,
    curved,
    curvedSideX - curvedSideSign * Math.min(0.1, curvedLayout.roofWidth / 4),
    curvedEdges.back,
  )
  if (!probeWorld) return null
  const worldHeightDelta = (point: readonly [number, number]) => {
    const curvedHeight = leanToTopHeightAtWorld(curvedWall, curved, point)
    const straightHeight = leanToTopHeightAtWorld(straightWall, straight, point)
    return curvedHeight === null || straightHeight === null ? null : curvedHeight - straightHeight
  }
  const probeDelta = worldHeightDelta(probeWorld)
  if (probeDelta === null || Math.abs(probeDelta) <= PLAN_TOLERANCE) return null
  const curvedRetainedSign = Math.sign(probeDelta)
  const straightSide = ownCurved ? candidateSide : side
  const straightLayout = resolveLeanToLayout(straight)
  const straightEdges = roofPlanEdges(straight)
  const straightSideSign = straightSide === 'left' ? -1 : 1
  const straightProbe = leanToPointToWorld(
    straightWall,
    straight,
    straightLayout.roofCenterX -
      straightSideSign *
        (straightLayout.roofWidth / 2 - Math.min(0.1, straightLayout.roofWidth / 4)),
    (straightEdges.back + straightEdges.front) / 2,
  )
  if (!straightProbe) return null

  // The equal-height cut only divides the shared footprint. Applying it to the
  // whole curved band removes roof area that the straight neighbor never covers.
  const curvedFacets = roofWorldFacets(curvedWall, curved)
  const straightBase = roofWorldFacets(straightWall, straight)[0]
  if (!straightBase) return null
  const overlaps = curvedFacets
    .map((facet) => intersectConvexPolygons(facet, straightBase))
    .filter((polygon) => polygon.length >= 3)
  if (overlaps.length === 0) return null

  let retainedWorld: LeanToPlanPoint[][]
  if (ownCurved) {
    retainedWorld = curvedFacets.flatMap((facet) => {
      const overlap = intersectConvexPolygons(facet, straightBase)
      const exclusive = subtractConvexPolygon(facet, straightBase)
      const retainedOverlap = clipToRetainedRoofSide(overlap, worldHeightDelta, curvedRetainedSign)
      return [...exclusive, ...(retainedOverlap.length >= 3 ? [retainedOverlap] : [])]
    })
  } else {
    let exclusive = [straightBase]
    for (const facet of curvedFacets) {
      exclusive = exclusive.flatMap((polygon) => subtractConvexPolygon(polygon, facet))
    }
    const connectedExclusive = connectedPlanPolygonComponent(exclusive, straightProbe)
    if (connectedExclusive.length > 0) exclusive = connectedExclusive
    const retainedOverlap = overlaps.flatMap((overlap) => {
      const piece = clipToRetainedRoofSide(overlap, worldHeightDelta, -curvedRetainedSign)
      return piece.length >= 3 ? [piece] : []
    })
    retainedWorld = [...exclusive, ...retainedOverlap]
  }

  const seamWorld: LeanToPlanPoint[] = []
  for (const overlap of overlaps) {
    for (let index = 0; index < overlap.length; index++) {
      const current = overlap[index]!
      const next = overlap[(index + 1) % overlap.length]!
      const currentDelta = worldHeightDelta(current)
      const nextDelta = worldHeightDelta(next)
      if (currentDelta === null || nextDelta === null) continue
      if (Math.abs(currentDelta) <= PLAN_TOLERANCE) seamWorld.push(current)
      if (currentDelta * nextDelta >= 0) continue
      const ratio = currentDelta / (currentDelta - nextDelta)
      seamWorld.push([
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ])
    }
  }
  const uniqueSeam = seamWorld.filter(
    (point, index) =>
      seamWorld.findIndex(
        (candidatePoint) => planDistance(point, candidatePoint) <= PLAN_TOLERANCE,
      ) === index,
  )
  let seamEndpoints: [LeanToPlanPoint, LeanToPlanPoint] | null = null
  for (const first of uniqueSeam) {
    for (const second of uniqueSeam) {
      if (!seamEndpoints || planDistance(first, second) > planDistance(...seamEndpoints)) {
        seamEndpoints = [first, second]
      }
    }
  }
  const pieces = retainedWorld.flatMap((polygon) => {
    const localized = polygon.map((point) => worldPointToLeanTo(wall, leanTo, point))
    if (localized.some((point) => !point)) return []
    const piece = localized as LeanToPlanPoint[]
    return piece.length >= 3 && Math.abs(polygonSignedArea(piece)) > PLAN_TOLERANCE ? [piece] : []
  })
  const localizedSeam = seamEndpoints?.map((point) => worldPointToLeanTo(wall, leanTo, point))
  const seam =
    localizedSeam?.[0] && localizedSeam[1]
      ? ([localizedSeam[0], localizedSeam[1]] as [LeanToPlanPoint, LeanToPlanPoint])
      : null
  if (pieces.length === 0 || !seam) return null

  return { piece: pieces[0]!, pieces, seam }
}

export function applyLeanToCornerRoofPieces(
  base: LeanToPlanPoint[],
  joints: Partial<Record<LeanToCornerSide, LeanToCornerJoint>>,
): LeanToPlanPoint[][] {
  let retained = [base]
  const additions: LeanToPlanPoint[][] = []
  let shouldUnionPieces = false
  for (const side of ['left', 'right'] as const) {
    const joint = joints[side]
    if (!joint || joint.roofPiece.length < 3) continue
    if (joint.kind === 'concave') {
      const clips = joint.roofPieces ?? [joint.roofPiece]
      shouldUnionPieces ||= joint.mergeRoofPieces === true
      retained = retained.flatMap((subject) =>
        clips.flatMap((clip) => {
          const intersection = intersectConvexPolygons(subject, clip)
          return intersection.length >= 3 &&
            Math.abs(polygonSignedArea(intersection)) > PLAN_TOLERANCE
            ? [intersection]
            : []
        }),
      )
    } else {
      const roofClips = joint.roofPieces
      if (roofClips) {
        shouldUnionPieces ||= joint.mergeRoofPieces === true
        retained = retained.flatMap((subject) =>
          roofClips.flatMap((clip) => {
            const intersection = intersectConvexPolygons(subject, clip)
            return intersection.length >= 3 &&
              Math.abs(polygonSignedArea(intersection)) > PLAN_TOLERANCE
              ? [intersection]
              : []
          }),
        )
      }
      additions.push(...(joint.roofAdditionPieces ?? [joint.roofPiece]))
    }
  }
  const pieces = [...retained, ...additions]
  return shouldUnionPieces ? (unionPolygons(pieces) as LeanToPlanPoint[][]) : pieces
}

function resolveRoofPiece(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  side: LeanToCornerSide,
  extension: number,
  candidate: LeanToExtensionNode,
  candidateWall: WallNode,
): {
  piece: LeanToPlanPoint[]
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null
} {
  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const originalSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
  const heightDelta = (point: readonly [number, number]): number | null => {
    const worldPoint = leanToPointToWorld(wall, leanTo, point[0], point[1])
    if (!worldPoint) return null
    const ownHeight = leanToTopHeightAtWorld(wall, leanTo, worldPoint)
    const candidateHeight = leanToTopHeightAtWorld(candidateWall, candidate, worldPoint)
    return ownHeight === null || candidateHeight === null ? null : ownHeight - candidateHeight
  }
  const probeDelta = heightDelta([
    originalSideX - sideSign * Math.min(0.1, layout.roofWidth / 4),
    (edges.back + edges.front) / 2,
  ])
  if (probeDelta === null || Math.abs(probeDelta) <= PLAN_TOLERANCE) {
    return { piece: [], seam: null }
  }
  const band = roofExtensionBand(leanTo, side, extension)
  const piece = clipToRetainedRoofSide(band, heightDelta, Math.sign(probeDelta))
  const seamPoints: LeanToPlanPoint[] = []
  for (let index = 0; index < band.length; index++) {
    const current = band[index]!
    const next = band[(index + 1) % band.length]!
    const currentDelta = heightDelta(current)
    const nextDelta = heightDelta(next)
    if (currentDelta === null || nextDelta === null) continue
    if (Math.abs(currentDelta) <= PLAN_TOLERANCE) seamPoints.push(current)
    if (currentDelta * nextDelta >= 0) continue
    const ratio = currentDelta / (currentDelta - nextDelta)
    seamPoints.push([
      current[0] + (next[0] - current[0]) * ratio,
      current[1] + (next[1] - current[1]) * ratio,
    ])
  }
  const uniqueSeam = seamPoints.filter(
    (point, index) =>
      seamPoints.findIndex((other) => planDistance(point, other) <= PLAN_TOLERANCE) === index,
  )
  return {
    piece,
    seam: uniqueSeam.length >= 2 ? [uniqueSeam[0]!, uniqueSeam[1]!] : null,
  }
}

function roofExtendedBasePolygon(
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  extension: number,
): LeanToPlanPoint[] {
  const polygon = roofBasePolygon(leanTo)
  const layout = resolveLeanToLayout(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const extendedSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2 + extension)
  const sideIndices = side === 'left' ? [0, 3] : [1, 2]
  for (const index of sideIndices) polygon[index]![0] = extendedSideX
  return polygon
}

function resolveFreestandingRoofPartition(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  side: LeanToCornerSide,
  kind: LeanToCornerJoint['kind'],
  extension: number,
  candidate: LeanToExtensionNode,
  candidateWall: WallNode,
  candidateSide: LeanToCornerSide,
  candidateExtension: number,
  trimConcaveCross: boolean,
): {
  basePieces: LeanToPlanPoint[][]
  additionPieces?: LeanToPlanPoint[][]
} | null {
  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const structuralSideX = sideSign * (layout.span / 2)
  const originalSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
  const heightDelta = (point: readonly [number, number]): number | null => {
    const worldPoint = leanToPointToWorld(wall, leanTo, point[0], point[1])
    if (!worldPoint) return null
    const ownHeight = leanToTopHeightAtWorld(wall, leanTo, worldPoint)
    const candidateHeight = leanToTopHeightAtWorld(candidateWall, candidate, worldPoint)
    return ownHeight === null || candidateHeight === null ? null : ownHeight - candidateHeight
  }
  const structuralProbeDelta = heightDelta([
    structuralSideX - sideSign * Math.min(0.1, layout.span / 4),
    (edges.back + edges.front) / 2,
  ])
  const probeDelta =
    structuralProbeDelta === null || Math.abs(structuralProbeDelta) <= PLAN_TOLERANCE
      ? heightDelta([
          originalSideX - sideSign * Math.min(0.1, layout.roofWidth / 4),
          (edges.back + edges.front) / 2,
        ])
      : structuralProbeDelta
  if (probeDelta === null || Math.abs(probeDelta) <= PLAN_TOLERANCE) return null

  const candidatePolygon = (
    kind === 'convex'
      ? roofExtendedBasePolygon(candidate, candidateSide, candidateExtension)
      : roofBasePolygon(candidate)
  ).flatMap((point) => {
    const worldPoint = leanToPointToWorld(candidateWall, candidate, point[0], point[1])
    const localized = worldPoint && worldPointToLeanTo(wall, leanTo, worldPoint)
    return localized ? [localized] : []
  })
  if (candidatePolygon.length < 3) return null

  const partition = (polygon: LeanToPlanPoint[]): LeanToPlanPoint[][] => {
    const overlap = intersectConvexPolygons(polygon, candidatePolygon)
    const exclusive = subtractConvexPolygon(polygon, candidatePolygon)
    const retainedOverlap = clipToRetainedRoofSide(
      overlap,
      heightDelta,
      (trimConcaveCross ? -1 : 1) * Math.sign(probeDelta),
    )
    const pieces = [...exclusive, retainedOverlap].filter(
      (piece) => piece.length >= 3 && Math.abs(polygonSignedArea(piece)) > PLAN_TOLERANCE,
    )
    return trimConcaveCross ? edgeConnectedPlanPolygonComponent(pieces, retainedOverlap) : pieces
  }

  const basePieces = partition(roofBasePolygon(leanTo))
  if (basePieces.length === 0) return null
  if (kind === 'concave') return { basePieces }
  const additionPieces = edgeConnectedPlanPolygonComponent(
    partition(roofExtensionBand(leanTo, side, extension)),
    roofBasePolygon(leanTo),
  )
  const connectedAdditions = edgeConnectedPlanPolygonComponents(additionPieces, basePieces)
  return connectedAdditions.length > 0
    ? { basePieces, additionPieces: connectedAdditions }
    : { basePieces }
}

function resolveCurvedStraightRoofPiece(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  side: LeanToCornerSide,
  extension: number,
  candidate: LeanToExtensionNode,
  candidateWall: WallNode,
  candidateSide: LeanToCornerSide,
  candidateExtension: number,
): {
  piece: LeanToPlanPoint[]
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null
} | null {
  const ownCurved = isCurvedLeanTo(leanTo)
  const candidateCurved = isCurvedLeanTo(candidate)
  if (ownCurved === candidateCurved) return null

  const layout = resolveLeanToLayout(leanTo)
  const edges = roofPlanEdges(leanTo)
  const sideSign = side === 'left' ? -1 : 1
  const sideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
  const curved = ownCurved ? leanTo : candidate
  const curvedWall = ownCurved ? wall : candidateWall
  const curvedSide = ownCurved ? side : candidateSide
  const curvedExtension = ownCurved ? extension : candidateExtension
  const curvedLayout = resolveLeanToLayout(curved)
  const curvedEdges = roofPlanEdges(curved)
  const curvedSideSign = curvedSide === 'left' ? -1 : 1
  const curvedSideX = curvedLayout.roofCenterX + curvedSideSign * (curvedLayout.roofWidth / 2)
  const curvedLowX = curvedSideX + curvedSideSign * curvedExtension
  const seamWorld = [
    leanToPointToWorld(curvedWall, curved, curvedSideX, curvedEdges.back),
    leanToPointToWorld(curvedWall, curved, curvedLowX, curvedEdges.front),
  ]
  if (seamWorld.some((point) => !point)) return null
  const localized = seamWorld.map((point) => worldPointToLeanTo(wall, leanTo, point!))
  if (localized.some((point) => !point)) return null
  const seamPoints = localized as [LeanToPlanPoint, LeanToPlanPoint]
  const seam: [LeanToPlanPoint, LeanToPlanPoint] = [seamPoints[0]!, seamPoints.at(-1)!]
  return {
    piece: [...seamPoints, [sideX, edges.front]],
    seam,
  }
}

export function resolveLeanToCornerJoints(
  leanTo: LeanToExtensionNode,
  wall: WallNode | undefined,
  nodes: Record<string, AnyNode> | undefined,
): Partial<Record<LeanToCornerSide, LeanToCornerJoint>> {
  if (!nodes) return {}
  const sourceLeanTo = leanTo
  const freestandingJoints =
    sourceLeanTo.hostKind === 'freestanding'
      ? resolveFreestandingCanopyJoints(sourceLeanTo, nodes)
      : undefined
  const ownFrame = resolveLeanToJointFrame(leanTo, wall)
  if (!ownFrame || !wallFrame(ownFrame.wall)) return {}
  leanTo = ownFrame.leanTo
  wall = ownFrame.wall
  const cornerLeanTo = applyLeanToWallCornerSpan(leanTo, wall)
  const tolerance = Math.max(
    0.35,
    (wall.thickness ?? 0.1) + Math.max(leanTo.leftOverhang, leanTo.rightOverhang),
  )
  const joints: Partial<Record<LeanToCornerSide, LeanToCornerJoint>> = {}

  for (const side of ['left', 'right'] as const) {
    const endpoint = endWorldPoint(wall, cornerLeanTo, side)
    const roofEndpoint = roofEndWorldPoint(wall, cornerLeanTo, side)
    if (!(endpoint && roofEndpoint)) continue
    for (const candidate of Object.values(nodes)) {
      if (candidate.type !== 'lean-to-extension' || candidate.id === sourceLeanTo.id) continue
      const storedCandidateWall = candidate.parentId ? nodes[candidate.parentId] : undefined
      const candidateFrame = resolveLeanToJointFrame(
        candidate,
        storedCandidateWall?.type === 'wall' ? storedCandidateWall : undefined,
      )
      if (!candidateFrame || candidateFrame.kind !== ownFrame.kind) continue
      if (
        ownFrame.kind === 'wall'
          ? candidateFrame.wall.parentId !== wall.parentId
          : candidate.parentId !== sourceLeanTo.parentId
      ) {
        continue
      }
      const candidateWall = candidateFrame.wall
      if (!wallFrame(candidateWall)) continue
      const cornerCandidate = applyLeanToWallCornerSpan(candidateFrame.leanTo, candidateWall)
      const linearNeighborSide = candidateRoofSideAtPoint(
        candidateWall,
        cornerCandidate,
        roofEndpoint,
      )
      if (linearNeighborSide) {
        const linearKind = cornerKindFromDirections(
          wall,
          cornerLeanTo,
          side,
          candidateWall,
          cornerCandidate,
          linearNeighborSide,
        )
        const linearJoint =
          linearKind === 'linear'
            ? resolveLinearJoint(
                wall,
                cornerLeanTo,
                side,
                candidateWall,
                cornerCandidate,
                linearNeighborSide,
              )
            : null
        if (linearJoint) {
          joints[side] = {
            side,
            kind: 'linear',
            neighborId: candidate.id,
            neighborSide: linearNeighborSide,
            roofExtension: 0,
            roofPiece: linearJoint.roofPiece,
            seam: linearJoint.seam,
            beamExtension: linearJoint.beamExtension,
            gutterMitre: 0,
            sharedPostOwner: String(cornerLeanTo.id) < String(candidate.id),
            sharedPostPosition: linearJoint.sharedPostPosition,
          }
          break
        }
      }
      if (!leanTo.autoMiterCorners || !candidate.autoMiterCorners) continue
      const expectedFreestandingJoint = freestandingJoints?.[side]
      if (
        ownFrame.kind === 'freestanding' &&
        expectedFreestandingJoint?.neighborId !== candidate.id
      ) {
        continue
      }
      const neighborSide = candidateSideAtPoint(candidateWall, cornerCandidate, endpoint, tolerance)
      if (!neighborSide) continue
      if (expectedFreestandingJoint && expectedFreestandingJoint.neighborSide !== neighborSide) {
        continue
      }
      const kind = cornerKindFromDirections(
        wall,
        cornerLeanTo,
        side,
        candidateWall,
        cornerCandidate,
        neighborSide,
      )
      if (!kind || kind === 'linear') continue
      if (
        !isSupportedHostCorner(
          wall,
          cornerLeanTo,
          side,
          candidateWall,
          cornerCandidate,
          neighborSide,
        )
      ) {
        continue
      }
      const interiorAngle = cornerInteriorAngle(
        wall,
        cornerLeanTo,
        side,
        candidateWall,
        cornerCandidate,
        neighborSide,
      )
      if (interiorAngle === null) continue

      const candidateLayout = resolveLeanToLayout(cornerCandidate)
      const layout = resolveLeanToLayout(cornerLeanTo)
      // A curved concave join is trimmed at the shared roof seam. Extending
      // the run from a straight chord into the curved band is not a valid
      // construction: the line/circle intersection can select the distant
      // branch and create runaway beam and gutter lengths.
      const curvedConcaveJoint =
        kind === 'concave' && (isCurvedLeanTo(cornerLeanTo) || isCurvedLeanTo(cornerCandidate))
      const sideSign = side === 'left' ? -1 : 1
      const ownEdges = roofPlanEdges(cornerLeanTo)
      const candidateEdges = roofPlanEdges(cornerCandidate)
      const roofSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
      const roofExtension = curvedConcaveJoint
        ? 0
        : (extensionToRunIntersection(
            wall,
            cornerLeanTo,
            side,
            roofSideX,
            ownEdges.front,
            candidateWall,
            cornerCandidate,
            candidateEdges.front,
          ) ?? 0)
      const candidateSideSign = neighborSide === 'left' ? -1 : 1
      const candidateRoofSideX =
        candidateLayout.roofCenterX + candidateSideSign * (candidateLayout.roofWidth / 2)
      const candidateRoofExtension = curvedConcaveJoint
        ? 0
        : (extensionToRunIntersection(
            candidateWall,
            cornerCandidate,
            neighborSide,
            candidateRoofSideX,
            candidateEdges.front,
            wall,
            cornerLeanTo,
            ownEdges.front,
          ) ?? 0)
      const curvedStraightRoof =
        kind === 'convex'
          ? resolveCurvedStraightRoofPiece(
              cornerLeanTo,
              wall,
              side,
              roofExtension,
              cornerCandidate,
              candidateWall,
              neighborSide,
              candidateRoofExtension,
            )
          : null
      const trimFreestandingConcaveCross = kind === 'concave'
      const freestandingRoof =
        ownFrame.kind === 'freestanding'
          ? resolveFreestandingRoofPartition(
              cornerLeanTo,
              wall,
              side,
              kind,
              roofExtension,
              cornerCandidate,
              candidateWall,
              neighborSide,
              candidateRoofExtension,
              trimFreestandingConcaveCross,
            )
          : null
      const curvedStraightConcaveRoof =
        kind === 'concave'
          ? resolveCurvedStraightConcaveRoofPiece(
              cornerLeanTo,
              wall,
              side,
              cornerCandidate,
              candidateWall,
              neighborSide,
            )
          : null
      const roof =
        curvedStraightRoof ??
        curvedStraightConcaveRoof ??
        (kind === 'convex'
          ? resolveRoofPiece(
              cornerLeanTo,
              wall,
              side,
              roofExtension,
              cornerCandidate,
              candidateWall,
            )
          : resolveConcaveRoofPiece(cornerLeanTo, wall, side, cornerCandidate, candidateWall))
      const seam =
        curvedStraightRoof || curvedStraightConcaveRoof
          ? roof.seam
          : sharedRoofSeam(
              wall,
              cornerLeanTo,
              side,
              roofExtension,
              candidateWall,
              cornerCandidate,
              neighborSide,
              candidateRoofExtension,
              kind,
            )
      const resolvedSeam = seam ?? roof.seam
      const resolvedRoofPieces = curvedStraightConcaveRoof?.pieces ??
        freestandingRoof?.basePieces ?? [roof.piece]
      const beamExtension = curvedConcaveJoint
        ? 0
        : (extensionToRunIntersection(
            wall,
            cornerLeanTo,
            side,
            sideSign * (layout.span / 2),
            layout.beamZ,
            candidateWall,
            cornerCandidate,
            candidateLayout.beamZ,
          ) ?? 0)
      const gutterAway = gutterAwayFromJointDirection(wall, cornerLeanTo, side, roofExtension)
      const candidateGutterAway = gutterAwayFromJointDirection(
        candidateWall,
        cornerCandidate,
        neighborSide,
        candidateRoofExtension,
      )
      // A curved wall can meet a straight wall at a roof seam while their
      // low eave curves never intersect. Do not apply a nominal angle miter
      // in that case: skewing both gutter ends creates a floating, uneven
      // joint instead of a valid shared edge.
      const gutterIntersection =
        gutterAway && candidateGutterAway
          ? extensionToRunIntersection(
              wall,
              cornerLeanTo,
              side,
              layout.roofCenterX + sideSign * (layout.roofWidth / 2),
              ownEdges.front,
              candidateWall,
              cornerCandidate,
              candidateEdges.front,
            ) !== null ||
            extensionToRunIntersection(
              candidateWall,
              cornerCandidate,
              neighborSide,
              candidateLayout.roofCenterX + candidateSideSign * (candidateLayout.roofWidth / 2),
              candidateEdges.front,
              wall,
              cornerLeanTo,
              ownEdges.front,
            ) !== null
          : false
      const gutterInteriorAngle =
        gutterAway && candidateGutterAway
          ? Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  gutterAway[0] * candidateGutterAway[0] + gutterAway[1] * candidateGutterAway[1],
                ),
              ),
            )
          : interiorAngle
      joints[side] = {
        side,
        kind,
        neighborId: candidate.id,
        neighborSide,
        roofExtension,
        roofPiece: roof.piece,
        roofPieces: curvedStraightConcaveRoof?.pieces ?? freestandingRoof?.basePieces,
        roofAdditionPieces: freestandingRoof?.additionPieces,
        mergeRoofPieces: freestandingRoof !== null,
        seam: resolvedSeam,
        framingRetainedSide:
          kind === 'concave'
            ? resolveFramingRetainedSide(resolvedSeam, resolvedRoofPieces)
            : undefined,
        beamExtension,
        gutterMitre: gutterIntersection
          ? (kind === 'concave' ? -1 : 1) * ((Math.PI - gutterInteriorAngle) / 2)
          : 0,
        sharedPostOwner: String(cornerLeanTo.id) < String(candidate.id),
        sharedPostPosition: [
          (side === 'left' ? -layout.span / 2 : layout.span / 2) +
            (side === 'left' ? -beamExtension : beamExtension),
          0,
          layout.beamZ,
        ],
      }
      break
    }
  }
  return joints
}

export type LeanToCornerJointMetadata = Partial<
  Record<
    LeanToCornerSide,
    Pick<
      LeanToCornerJoint,
      'beamExtension' | 'gutterMitre' | 'seam' | 'framingRetainedSide' | 'sharedPostOwner'
    >
  >
>

export function leanToCornerJointMetadata(
  joints: Partial<Record<LeanToCornerSide, LeanToCornerJoint>>,
): LeanToCornerJointMetadata {
  return Object.fromEntries(
    Object.entries(joints).map(([side, joint]) => [
      side,
      joint
        ? {
            beamExtension: joint.beamExtension,
            gutterMitre: joint.gutterMitre,
            seam: joint.seam,
            framingRetainedSide: joint.framingRetainedSide,
            sharedPostOwner: joint.sharedPostOwner,
          }
        : undefined,
    ]),
  )
}

export function readLeanToCornerJointMetadata(
  leanTo: LeanToExtensionNode,
): LeanToCornerJointMetadata {
  const metadata = leanTo.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const value = (metadata as Record<string, unknown>)[LEAN_TO_CORNER_JOINTS_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as LeanToCornerJointMetadata)
    : {}
}
