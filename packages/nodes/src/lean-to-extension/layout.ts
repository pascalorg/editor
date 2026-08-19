import {
  type AnyNode,
  type AnyNodeId,
  getWallArcData,
  getWallChordFrame,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  LeanToExtensionNode,
  type WallNode,
} from '@pascal-app/core'
import { EAVE_TUCK_INWARD } from '../gutter/eave-snap'
import { type LeanToArcFrame, leanToArcFrameAtLocalX } from './arc'

export const MIN_LEAN_TO_POST_HEIGHT = 0.2
export const MIN_LEAN_TO_WALL_LENGTH = 0.6
export const LEAN_TO_EXTENSION_GEOMETRY_REVISION = 8
const LEAN_TO_EDGE_SNAP_TOLERANCE = 0.25
const CURVED_INNER_EDGE_CLEARANCE = 0.15

export type LeanToLayout = {
  span: number
  projection: number
  roofRun: number
  roofWidth: number
  roofCenterX: number
  slopeLength: number
  rafterSlopeLength: number
  pitchRadians: number
  effectivePitchDegrees: number
  highEdgeHeight: number
  lowEdgeHeight: number
  eaveEdgeHeight: number
  roofCenterY: number
  roofCenterZ: number
  rafterCenterY: number
  rafterCenterZ: number
  beamSpan: number
  beamCenterY: number
  beamZ: number
  postHeight: number
  postXs: number[]
  rafterXs: number[]
  postFrames: LeanToArcFrame[]
  rafterFrames: LeanToArcFrame[]
}

export function leanToLowEdgeHeight(
  node: Pick<LeanToExtensionNode, 'highEdgeHeight' | 'pitch' | 'projection'>,
): number {
  return node.highEdgeHeight - node.projection * Math.tan((node.pitch * Math.PI) / 180)
}

export function resolveLeanToWallSurfaceHit(
  wall: WallNode,
  localPosition: readonly [number, number, number],
  normal: readonly [number, number, number] | undefined,
): { localX: number; side: 'front' | 'back' } | null {
  if (!normal) return null
  if (!isCurvedWall(wall)) {
    if (Math.abs(normal[2]) <= 0.7) return null
    return { localX: localPosition[0], side: normal[2] >= 0 ? 'front' : 'back' }
  }
  if (Math.abs(normal[1]) > 0.7) return null

  const arc = getWallArcData(wall)
  if (!arc) return null
  const chord = getWallChordFrame(wall)
  const point = {
    x: chord.start.x + chord.tangent.x * localPosition[0] + chord.normal.x * localPosition[2],
    y: chord.start.y + chord.tangent.y * localPosition[0] + chord.normal.y * localPosition[2],
  }
  const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x)
  let directedAngle = (angle - arc.startAngle) * arc.direction
  while (directedAngle < 0) directedAngle += Math.PI * 2
  const t = Math.max(0, Math.min(1, directedAngle / Math.abs(arc.delta)))
  const frame = getWallCurveFrameAt(wall, t)
  const signedOffset =
    (point.x - frame.point.x) * frame.normal.x + (point.y - frame.point.y) * frame.normal.y
  return {
    localX: getWallCurveLength(wall) * t,
    side: signedOffset >= 0 ? 'front' : 'back',
  }
}

export function applyLeanToCurveProjectionLimit(node: LeanToExtensionNode): LeanToExtensionNode {
  const centerZ = node.spanArcCenterZ
  if (centerZ == null || centerZ <= 0) return node
  const maximumProjection = centerZ - Math.max(0, node.lowOverhang) - CURVED_INNER_EDGE_CLEARANCE
  if (maximumProjection < 0.5 || node.projection <= maximumProjection) return node
  const projection = maximumProjection
  return {
    ...node,
    projection,
    lowEdgeHeight: leanToLowEdgeHeight({ ...node, projection }),
  }
}

export function resolveLeanToLayout(node: LeanToExtensionNode): LeanToLayout {
  const span = Math.max(0.5, node.span)
  const projection = Math.max(0.5, node.projection)
  const highOverhang = Math.max(0, node.highOverhang)
  const lowOverhang = Math.max(0, node.lowOverhang)
  const roofRun = highOverhang + projection + lowOverhang
  const roofWidth = span + Math.max(0, node.leftOverhang) + Math.max(0, node.rightOverhang)
  const roofCenterX = (Math.max(0, node.rightOverhang) - Math.max(0, node.leftOverhang)) / 2
  const requestedPitch = (Math.max(1, Math.min(45, node.pitch)) * Math.PI) / 180
  const roofBuildUp =
    node.roofThickness / Math.max(0.1, Math.cos(requestedPitch)) +
    (node.shingleThickness ?? 0.025) * Math.cos(requestedPitch)
  const minimumLowEdge = MIN_LEAN_TO_POST_HEIGHT + node.beamHeight + node.rafterHeight + roofBuildUp
  const maximumDrop = Math.max(0, node.highEdgeHeight - minimumLowEdge)
  const maximumPitch = Math.atan2(maximumDrop, projection)
  const pitchRadians = Math.min(requestedPitch, maximumPitch)
  const effectivePitchDegrees = (pitchRadians * 180) / Math.PI
  const lowEdgeHeight = node.highEdgeHeight - projection * Math.tan(pitchRadians)
  const eaveEdgeHeight = node.highEdgeHeight - (projection + lowOverhang) * Math.tan(pitchRadians)
  const roofCenterZ = (projection + lowOverhang - highOverhang) / 2
  const roofCenterY = node.highEdgeHeight - roofCenterZ * Math.tan(pitchRadians)
  const effectiveRoofBuildUp =
    node.roofThickness / Math.max(0.1, Math.cos(pitchRadians)) +
    (node.shingleThickness ?? 0.025) * Math.cos(pitchRadians)
  const gutterBackRun = projection + Math.max(0, lowOverhang - EAVE_TUCK_INWARD)
  const rafterCornerProjection = (node.rafterHeight / 2) * Math.sin(pitchRadians)
  const rafterRun = Math.max(
    gutterBackRun - rafterCornerProjection,
    projection + node.beamWidth / 2,
  )
  const rafterCenterZ = rafterRun / 2
  const rafterCenterY =
    node.highEdgeHeight -
    rafterCenterZ * Math.tan(pitchRadians) -
    effectiveRoofBuildUp -
    node.rafterHeight / 2
  const beamZ = Math.max(0, projection - node.lowBeamInset)
  const beamTop =
    node.highEdgeHeight - beamZ * Math.tan(pitchRadians) - effectiveRoofBuildUp - node.rafterHeight
  const beamCenterY = beamTop - node.beamHeight / 2
  const postHeight = Math.max(MIN_LEAN_TO_POST_HEIGHT, beamCenterY - node.beamHeight / 2)
  const usablePostSpan = Math.max(0.1, span - 2 * Math.max(0, node.postInset))
  const postCount =
    node.postLayoutMode === 'target-spacing'
      ? Math.max(2, Math.min(20, Math.ceil(usablePostSpan / node.postSpacing) + 1))
      : node.postCount
  const postXs = evenlySpacedXs(span, postCount, node.postInset)
  const beamSpan = Math.max(
    node.postWidth,
    (postXs.at(-1) ?? 0) - (postXs[0] ?? 0) + node.postWidth,
  )
  const usableRafterSpan = Math.max(0.1, span - 2 * Math.max(0, node.rafterEndInset))
  const rafterCount = Math.max(2, Math.ceil(usableRafterSpan / node.rafterSpacing) + 1)
  const rafterXs = evenlySpacedXs(span, rafterCount, node.rafterEndInset)

  return {
    span,
    projection,
    roofRun,
    roofWidth,
    roofCenterX,
    slopeLength: roofRun / Math.max(0.001, Math.cos(pitchRadians)),
    rafterSlopeLength: rafterRun / Math.max(0.001, Math.cos(pitchRadians)),
    pitchRadians,
    effectivePitchDegrees,
    highEdgeHeight: node.highEdgeHeight,
    lowEdgeHeight,
    eaveEdgeHeight,
    roofCenterY,
    roofCenterZ,
    rafterCenterY,
    rafterCenterZ,
    beamSpan,
    beamCenterY,
    beamZ,
    postHeight,
    postXs,
    rafterXs,
    postFrames: postXs.map((x) => leanToArcFrameAtLocalX(node, x)),
    rafterFrames: rafterXs.map((x) => leanToArcFrameAtLocalX(node, x)),
  }
}

// The host wall's true circular arc expressed in the lean-to's local frame. The
// anchor frame is sampled at the lean-to's along-wall position (the span center),
// so the arc center lies on the local Z axis (local X = 0): `centerZ` is its local
// Z, `radius` is the wall's true radius. Returns null for a straight wall.
export function resolveLeanToSpanArc(
  wall: WallNode,
  node: Pick<LeanToExtensionNode, 'position' | 'rotation'>,
): { centerZ: number; radius: number } | null {
  if (!isCurvedWall(wall)) return null
  const arc = getWallArcData(wall)
  if (!arc) return null
  const arcLength = getWallCurveLength(wall)
  if (arcLength <= 1e-6) return null
  const t = Math.max(0, Math.min(1, node.position[0] / arcLength))
  const frame = getWallCurveFrameAt(wall, t)
  // Signed radial distance from the anchor wall point to the arc center along the
  // outward normal (= ±radius; the tangent component is zero by construction).
  const d =
    (arc.center.x - frame.point.x) * frame.normal.x +
    (arc.center.y - frame.point.y) * frame.normal.y
  const sideSign = Math.cos(node.rotation[1]) >= 0 ? 1 : -1
  return { centerZ: sideSign * (d - node.position[2]), radius: arc.radius }
}

export function resolveLeanToMoveCenterX(
  node: LeanToExtensionNode,
  wall: WallNode,
  rawLocalX: number,
  snapStep = 0,
  edgeSnapTargets: readonly LeanToEdgeSnapTarget[] = [],
): number {
  const wallLength = getWallCurveLength(wall)
  const snapped = snapStep > 0 ? Math.round(rawLocalX / snapStep) * snapStep : rawLocalX
  const min = node.span / 2 + Math.max(0, node.leftOverhang)
  const max = wallLength - node.span / 2 - Math.max(0, node.rightOverhang)
  if (max < min) return wallLength / 2
  const clamped = Math.max(min, Math.min(max, snapped))
  return snapLeanToMoveCenterToEdges(node, clamped, min, max, edgeSnapTargets)
}

export type LeanToEdgeSnapTarget = {
  leftEdgeX: number
  rightEdgeX: number
}

function leanToEdgeSnapTarget(node: LeanToExtensionNode): LeanToEdgeSnapTarget {
  return {
    leftEdgeX: node.position[0] - node.span / 2 - Math.max(0, node.leftOverhang),
    rightEdgeX: node.position[0] + node.span / 2 + Math.max(0, node.rightOverhang),
  }
}

function snapLeanToMoveCenterToEdges(
  node: LeanToExtensionNode,
  centerX: number,
  min: number,
  max: number,
  targets: readonly LeanToEdgeSnapTarget[],
): number {
  const movingLeft = centerX - node.span / 2 - Math.max(0, node.leftOverhang)
  const movingRight = centerX + node.span / 2 + Math.max(0, node.rightOverhang)
  let best: { centerX: number; distance: number } | null = null

  for (const target of targets) {
    const leftToRight = Math.abs(movingLeft - target.rightEdgeX)
    if (leftToRight <= LEAN_TO_EDGE_SNAP_TOLERANCE) {
      const snappedCenter = target.rightEdgeX + node.span / 2 + Math.max(0, node.leftOverhang)
      if (snappedCenter >= min && snappedCenter <= max) {
        best =
          !best || leftToRight < best.distance
            ? { centerX: snappedCenter, distance: leftToRight }
            : best
      }
    }

    const rightToLeft = Math.abs(movingRight - target.leftEdgeX)
    if (rightToLeft <= LEAN_TO_EDGE_SNAP_TOLERANCE) {
      const snappedCenter = target.leftEdgeX - node.span / 2 - Math.max(0, node.rightOverhang)
      if (snappedCenter >= min && snappedCenter <= max) {
        best =
          !best || rightToLeft < best.distance
            ? { centerX: snappedCenter, distance: rightToLeft }
            : best
      }
    }
  }

  return best?.centerX ?? centerX
}

export function resolveLeanToEdgeSnapTargets(
  node: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToEdgeSnapTarget[] {
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (wallLength <= 1e-6) return []
  const wallDx = (wall.end[0] - wall.start[0]) / wallLength
  const wallDz = (wall.end[1] - wall.start[1]) / wallLength
  const sameSideSign = Math.sign(Math.cos(node.rotation[1])) || 1
  const targets: LeanToEdgeSnapTarget[] = []

  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'lean-to-extension' || candidate.id === node.id) continue
    if ((Math.sign(Math.cos(candidate.rotation[1])) || 1) !== sameSideSign) continue
    const host = candidate.parentId ? nodes[candidate.parentId as AnyNodeId] : undefined
    if (host?.type !== 'wall') continue
    const hostLength = Math.hypot(host.end[0] - host.start[0], host.end[1] - host.start[1])
    if (hostLength <= 1e-6) continue
    const hostDx = (host.end[0] - host.start[0]) / hostLength
    const hostDz = (host.end[1] - host.start[1]) / hostLength
    const parallel = wallDx * hostDx + wallDz * hostDz
    if (parallel < 0.999) continue
    const offsetFromWall =
      (host.start[0] - wall.start[0]) * -wallDz + (host.start[1] - wall.start[1]) * wallDx
    if (Math.abs(offsetFromWall) > (wall.thickness ?? 0.1) + LEAN_TO_EDGE_SNAP_TOLERANCE) {
      continue
    }
    const hostStartX =
      (host.start[0] - wall.start[0]) * wallDx + (host.start[1] - wall.start[1]) * wallDz
    const candidateTarget = leanToEdgeSnapTarget(candidate)
    targets.push({
      leftEdgeX: hostStartX + candidateTarget.leftEdgeX,
      rightEdgeX: hostStartX + candidateTarget.rightEdgeX,
    })
  }

  return targets
}

function evenlySpacedXs(span: number, count: number, requestedInset: number): number[] {
  const resolvedCount = Math.max(2, Math.round(count))
  const inset = Math.min(Math.max(0, requestedInset), Math.max(0, span / 2 - 0.05))
  const first = -span / 2 + inset
  const last = span / 2 - inset
  const step = (last - first) / (resolvedCount - 1)
  return Array.from({ length: resolvedCount }, (_, index) => first + index * step)
}

export function resolveLeanToWallPlacement(
  wall: WallNode,
  rawLocalX: number,
  side: 'front' | 'back',
  overrides: Partial<LeanToExtensionNode> = {},
): LeanToExtensionNode | null {
  const wallLength = getWallCurveLength(wall)
  if (wallLength < MIN_LEAN_TO_WALL_LENGTH) return null

  const requestedSpan = typeof overrides.span === 'number' ? overrides.span : 4
  const span = Math.max(0.5, Math.min(requestedSpan, wallLength - 0.1))
  const localX = Math.max(span / 2, Math.min(wallLength - span / 2, rawLocalX))
  const thickness = wall.thickness ?? 0.1
  const positionZ = side === 'front' ? thickness / 2 : -thickness / 2
  const rotationY = side === 'front' ? 0 : Math.PI

  const parsed = LeanToExtensionNode.parse({
    ...overrides,
    name: overrides.name ?? 'Lean-to Extension',
    parentId: wall.id,
    position: [localX, 0, positionZ],
    rotation: [0, rotationY, 0],
    span,
    highEdgeHeight: overrides.highEdgeHeight ?? Math.max(1.2, (wall.height ?? 2.4) - 0.1),
  })
  const spanArc = resolveLeanToSpanArc(wall, parsed)
  return applyLeanToCurveProjectionLimit({
    ...parsed,
    spanArcCenterZ: spanArc?.centerZ,
    spanArcRadius: spanArc?.radius,
    lowEdgeHeight: leanToLowEdgeHeight(parsed),
  })
}

export function leanToWallLocalPose(
  wall: WallNode,
  node: LeanToExtensionNode,
  baseY: number,
): { position: [number, number, number]; rotationY: number } {
  const [localX, localY, localZ] = node.position
  const arcLength = getWallCurveLength(wall)
  const t = arcLength > 1e-6 ? Math.max(0, Math.min(1, localX / arcLength)) : 0
  const frame = getWallCurveFrameAt(wall, t)
  const angle = Math.atan2(frame.tangent.y, frame.tangent.x)
  return {
    position: [
      frame.point.x + frame.normal.x * localZ,
      baseY + localY,
      frame.point.y + frame.normal.y * localZ,
    ],
    rotationY: -angle + node.rotation[1],
  }
}

// The wall mesh is rooted at the chord start and rotated to the chord tangent.
// Curved hosted nodes still store their X coordinate as centerline arc length,
// so their committed renderer must resolve the actual curve point and tangent,
// then express that world pose back in the parent wall mesh's local frame.
export function resolveLeanToParentPose(
  wall: WallNode,
  node: LeanToExtensionNode,
): { position: [number, number, number]; rotationY: number } {
  const worldPose = leanToWallLocalPose(wall, node, 0)
  const wallAngle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cos = Math.cos(wallAngle)
  const sin = Math.sin(wallAngle)
  const dx = worldPose.position[0] - wall.start[0]
  const dz = worldPose.position[2] - wall.start[1]
  return {
    position: [dx * cos + dz * sin, node.position[1], -dx * sin + dz * cos],
    rotationY: worldPose.rotationY + wallAngle,
  }
}
