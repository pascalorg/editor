import type { AnyNode, LeanToExtensionNode, WallNode } from '@pascal-app/core'
import { resolveLeanToLayout } from './layout'

export type LeanToCornerSide = 'left' | 'right'
export type LeanToPlanPoint = [number, number]

export type LeanToCornerJoint = {
  side: LeanToCornerSide
  neighborId: string
  neighborSide: LeanToCornerSide
  roofExtension: number
  roofPiece: LeanToPlanPoint[]
  seam: [LeanToPlanPoint, LeanToPlanPoint] | null
  beamExtension: number
  gutterMitre: number
  sharedPostOwner: boolean
  sharedPostPosition: [number, number, number]
}

export const LEAN_TO_CORNER_JOINTS_KEY = 'leanToCornerJoints'

const WALL_CONNECTION_OVERLAP = 0.02
const WALL_CONNECTION_TRIM = 0.002
const PLAN_TOLERANCE = 1e-6
const MIN_CORNER_ANGLE = Math.PI / 6
const MAX_CORNER_ANGLE = (5 * Math.PI) / 6

function planDistance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
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

function leanToOutwardDirection(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
): LeanToPlanPoint | null {
  const frame = wallFrame(wall)
  if (!frame) return null
  const cos = Math.cos(leanTo.rotation[1])
  const sin = Math.sin(leanTo.rotation[1])
  return [
    frame.along[0] * sin + frame.perpendicular[0] * cos,
    frame.along[1] * sin + frame.perpendicular[1] * cos,
  ]
}

function awayFromEndDirection(
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

function directionsFaceConvexCorner(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
): boolean {
  const outward = leanToOutwardDirection(wall, leanTo)
  const candidateOutward = leanToOutwardDirection(candidateWall, candidate)
  const away = awayFromEndDirection(wall, leanTo, side)
  const candidateAway = awayFromEndDirection(candidateWall, candidate, candidateSide)
  if (!(outward && candidateOutward && away && candidateAway)) return false
  return (
    outward[0] * candidateAway[0] + outward[1] * candidateAway[1] < -PLAN_TOLERANCE &&
    candidateOutward[0] * away[0] + candidateOutward[1] * away[1] < -PLAN_TOLERANCE
  )
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
  const angle = Math.acos(dot)
  return angle >= MIN_CORNER_ANGLE - PLAN_TOLERANCE && angle <= MAX_CORNER_ANGLE + PLAN_TOLERANCE
    ? angle
    : null
}

function leanToPointToWorld(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  localX: number,
  localZ: number,
): LeanToPlanPoint | null {
  const frame = wallFrame(wall)
  if (!frame) return null
  const cos = Math.cos(leanTo.rotation[1])
  const sin = Math.sin(leanTo.rotation[1])
  const wallX = leanTo.position[0] + localX * cos + localZ * sin
  const wallZ = leanTo.position[2] - localX * sin + localZ * cos
  return [
    frame.start[0] + frame.along[0] * wallX + frame.perpendicular[0] * wallZ,
    frame.start[1] + frame.along[1] * wallX + frame.perpendicular[1] * wallZ,
  ]
}

function worldPointToLeanTo(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  point: readonly [number, number],
): LeanToPlanPoint | null {
  const frame = wallFrame(wall)
  if (!frame) return null
  const dx = point[0] - frame.start[0]
  const dz = point[1] - frame.start[1]
  const relativeX = dx * frame.along[0] + dz * frame.along[1] - leanTo.position[0]
  const relativeZ = dx * frame.perpendicular[0] + dz * frame.perpendicular[1] - leanTo.position[2]
  const cos = Math.cos(leanTo.rotation[1])
  const sin = Math.sin(leanTo.rotation[1])
  return [relativeX * cos - relativeZ * sin, relativeX * sin + relativeZ * cos]
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
  const sideSign = side === 'left' ? -1 : 1
  return Math.max(
    0,
    sideSign *
      ((intersection[0] - ownBoundary[0]) * ownDirection[0] +
        (intersection[1] - ownBoundary[1]) * ownDirection[1]),
  )
}

function leanToTopHeightAtWorld(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  point: readonly [number, number],
): number | null {
  const frame = wallFrame(wall)
  if (!frame) return null
  const dx = point[0] - frame.start[0]
  const dz = point[1] - frame.start[1]
  const wallX = dx * frame.along[0] + dz * frame.along[1]
  const wallZ = dx * frame.perpendicular[0] + dz * frame.perpendicular[1]
  const relativeX = wallX - leanTo.position[0]
  const relativeZ = wallZ - leanTo.position[2]
  const localZ = relativeX * Math.sin(leanTo.rotation[1]) + relativeZ * Math.cos(leanTo.rotation[1])
  const layout = resolveLeanToLayout(leanTo)
  return leanTo.position[1] + layout.highEdgeHeight - localZ * Math.tan(layout.pitchRadians)
}

function roofPlanEdges(leanTo: LeanToExtensionNode): { back: number; front: number } {
  const layout = resolveLeanToLayout(leanTo)
  const depth = layout.roofRun + WALL_CONNECTION_OVERLAP
  const centerZ =
    depth / 2 - Math.max(0, leanTo.highOverhang) - WALL_CONNECTION_TRIM - WALL_CONNECTION_OVERLAP
  return {
    back: centerZ - depth / 2 + (leanTo.highOverhang > 0 ? 0 : WALL_CONNECTION_TRIM),
    front: centerZ + depth / 2,
  }
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

function polygonSignedArea(polygon: readonly LeanToPlanPoint[]): number {
  let area = 0
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
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

function sharedRoofSeam(
  wall: WallNode,
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  extension: number,
  candidateWall: WallNode,
  candidate: LeanToExtensionNode,
  candidateSide: LeanToCornerSide,
  candidateExtension: number,
): [LeanToPlanPoint, LeanToPlanPoint] | null {
  const ownBand = roofExtensionBand(leanTo, side, extension).flatMap((point) => {
    const world = leanToPointToWorld(wall, leanTo, point[0], point[1])
    return world ? [world] : []
  })
  const candidateBand = roofExtensionBand(candidate, candidateSide, candidateExtension).flatMap(
    (point) => {
      const world = leanToPointToWorld(candidateWall, candidate, point[0], point[1])
      return world ? [world] : []
    },
  )
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

function resolveRoofPiece(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  side: LeanToCornerSide,
  extension: number,
  candidate: LeanToExtensionNode,
  candidateWall: WallNode,
): { piece: LeanToPlanPoint[]; seam: [LeanToPlanPoint, LeanToPlanPoint] | null } {
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

export function resolveLeanToCornerJoints(
  leanTo: LeanToExtensionNode,
  wall: WallNode | undefined,
  nodes: Record<string, AnyNode> | undefined,
): Partial<Record<LeanToCornerSide, LeanToCornerJoint>> {
  if (!leanTo.autoMiterCorners || !wall || !nodes) return {}
  if (!wallFrame(wall)) return {}
  const tolerance = Math.max(
    0.35,
    (wall.thickness ?? 0.1) + Math.max(leanTo.leftOverhang, leanTo.rightOverhang),
  )
  const joints: Partial<Record<LeanToCornerSide, LeanToCornerJoint>> = {}

  for (const side of ['left', 'right'] as const) {
    const endpoint = endWorldPoint(wall, leanTo, side)
    if (!endpoint) continue
    for (const candidate of Object.values(nodes)) {
      if (candidate.type !== 'lean-to-extension' || candidate.id === leanTo.id) continue
      if (!candidate.autoMiterCorners) continue
      const candidateWall = candidate.parentId ? nodes[candidate.parentId] : undefined
      if (candidateWall?.type !== 'wall' || candidateWall.parentId !== wall.parentId) continue
      if (!wallFrame(candidateWall)) continue
      const neighborSide = candidateSideAtPoint(candidateWall, candidate, endpoint, tolerance)
      if (!neighborSide) continue
      if (!directionsFaceConvexCorner(wall, leanTo, side, candidateWall, candidate, neighborSide)) {
        continue
      }
      const interiorAngle = cornerInteriorAngle(
        wall,
        leanTo,
        side,
        candidateWall,
        candidate,
        neighborSide,
      )
      if (interiorAngle === null) continue

      const candidateLayout = resolveLeanToLayout(candidate)
      const layout = resolveLeanToLayout(leanTo)
      const sideSign = side === 'left' ? -1 : 1
      const ownEdges = roofPlanEdges(leanTo)
      const candidateEdges = roofPlanEdges(candidate)
      const roofSideX = layout.roofCenterX + sideSign * (layout.roofWidth / 2)
      const roofExtension =
        extensionToRunIntersection(
          wall,
          leanTo,
          side,
          roofSideX,
          ownEdges.front,
          candidateWall,
          candidate,
          candidateEdges.front,
        ) ?? 0
      const roof = resolveRoofPiece(leanTo, wall, side, roofExtension, candidate, candidateWall)
      const candidateSideSign = neighborSide === 'left' ? -1 : 1
      const candidateRoofSideX =
        candidateLayout.roofCenterX + candidateSideSign * (candidateLayout.roofWidth / 2)
      const candidateRoofExtension =
        extensionToRunIntersection(
          candidateWall,
          candidate,
          neighborSide,
          candidateRoofSideX,
          candidateEdges.front,
          wall,
          leanTo,
          ownEdges.front,
        ) ?? 0
      const seam = sharedRoofSeam(
        wall,
        leanTo,
        side,
        roofExtension,
        candidateWall,
        candidate,
        neighborSide,
        candidateRoofExtension,
      )
      const beamExtension =
        extensionToRunIntersection(
          wall,
          leanTo,
          side,
          sideSign * (layout.span / 2),
          layout.beamZ,
          candidateWall,
          candidate,
          candidateLayout.beamZ,
        ) ?? 0
      joints[side] = {
        side,
        neighborId: candidate.id,
        neighborSide,
        roofExtension,
        roofPiece: roof.piece,
        seam: seam ?? roof.seam,
        beamExtension,
        gutterMitre: (Math.PI - interiorAngle) / 2,
        sharedPostOwner: String(leanTo.id) < String(candidate.id),
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
    Pick<LeanToCornerJoint, 'beamExtension' | 'gutterMitre' | 'seam' | 'sharedPostOwner'>
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
