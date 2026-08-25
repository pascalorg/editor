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
import { resolveWallAttachmentAtPlanPoint } from '../shared/wall-attach-target'
import { type LeanToArcFrame, leanToArcFrameAtLocalX } from './arc'
import { isClosedLoopLeanTo } from './conical-host'

export const MIN_LEAN_TO_POST_HEIGHT = 0.2
export const MIN_LEAN_TO_WALL_LENGTH = 0.6
export const LEAN_TO_EXTENSION_GEOMETRY_REVISION = 8
export const LEAN_TO_EDGE_SNAP_TOLERANCE = 0.25
export const LEAN_TO_HEIGHT_SNAP_TOLERANCE = 0.15
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
  } else if (Math.abs(normal[1]) > 0.7) {
    return null
  }

  const chord = getWallChordFrame(wall)
  if (chord.length <= 1e-6) return null
  const point: [number, number] = [
    chord.start.x + chord.tangent.x * localPosition[0] + chord.normal.x * localPosition[2],
    chord.start.y + chord.tangent.y * localPosition[0] + chord.normal.y * localPosition[2],
  ]
  const attachment = resolveWallAttachmentAtPlanPoint(wall, point)
  if (!attachment) return null
  return {
    localX: attachment.localX,
    side: attachment.side,
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
  const closedLoop = isClosedLoopLeanTo(node)
  const postCount =
    node.postLayoutMode === 'target-spacing'
      ? Math.max(
          closedLoop ? 3 : 2,
          Math.min(20, Math.ceil(usablePostSpan / node.postSpacing) + (closedLoop ? 0 : 1)),
        )
      : node.postCount
  const postXs = closedLoop
    ? evenlySpacedLoopXs(span, postCount)
    : evenlySpacedXs(span, postCount, node.postInset)
  const beamSpan = closedLoop
    ? span
    : Math.max(node.postWidth, (postXs.at(-1) ?? 0) - (postXs[0] ?? 0) + node.postWidth)
  const usableRafterSpan = Math.max(0.1, span - 2 * Math.max(0, node.rafterEndInset))
  const rafterCount = Math.max(
    closedLoop ? 3 : 2,
    Math.ceil(usableRafterSpan / node.rafterSpacing) + (closedLoop ? 0 : 1),
  )
  const rafterXs = closedLoop
    ? evenlySpacedLoopXs(span, rafterCount)
    : evenlySpacedXs(span, rafterCount, node.rafterEndInset)

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

/**
 * Plan-space center of the rendered lean-to footprint, measured from the node
 * origin. Placement tools use this shared offset so the pointer marks the
 * center of the whole footprint rather than the high-edge origin.
 */
export function resolveLeanToPlanCenter(node: LeanToExtensionNode): [number, number] {
  const layout = resolveLeanToLayout(node)
  return [layout.roofCenterX, layout.roofCenterZ]
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
  return resolveLeanToMoveProposal({
    node,
    wall,
    rawLocalX,
    rawHighEdgeHeight: node.highEdgeHeight,
    snapStep,
    edgeSnapTargets,
  }).centerX
}

export type LeanToMoveProposal = {
  centerX: number
  highEdgeHeight: number
  lowEdgeHeight: number
}

export function resolveLeanToMoveProposal({
  node,
  wall,
  rawLocalX,
  rawHighEdgeHeight,
  snapStep = 0,
  edgeSnapTargets = [],
}: {
  node: LeanToExtensionNode
  wall: WallNode
  rawLocalX: number
  rawHighEdgeHeight: number
  snapStep?: number
  edgeSnapTargets?: readonly LeanToEdgeSnapTarget[]
}): LeanToMoveProposal {
  const wallLength = getWallCurveLength(wall)
  const snapped = snapStep > 0 ? Math.round(rawLocalX / snapStep) * snapStep : rawLocalX
  const min = node.span / 2 + Math.max(0, node.leftOverhang)
  const max = wallLength - node.span / 2 - Math.max(0, node.rightOverhang)
  const rawHeightDelta = rawHighEdgeHeight - node.highEdgeHeight
  if (max < min) {
    return {
      centerX: wallLength / 2,
      highEdgeHeight: rawHighEdgeHeight,
      lowEdgeHeight: node.lowEdgeHeight + rawHeightDelta,
    }
  }
  const clamped = Math.max(min, Math.min(max, snapped))
  const edgeSnap = snapLeanToMoveCenterToEdges(node, clamped, min, max, edgeSnapTargets)
  const highEdgeHeight = edgeSnap ? edgeSnap.target.roofEdgeY - node.position[1] : rawHighEdgeHeight
  return {
    centerX: edgeSnap?.centerX ?? clamped,
    highEdgeHeight,
    lowEdgeHeight: node.lowEdgeHeight + highEdgeHeight - node.highEdgeHeight,
  }
}

export type LeanToEdgeSnapTarget = {
  leftEdgeX: number
  rightEdgeX: number
  roofEdgeY: number
  pitch?: number
  nodeId?: AnyNodeId
  anchor?: readonly [number, number]
}

export type LeanToHeightSnapMatch = {
  highEdgeHeight: number
  target: LeanToEdgeSnapTarget
}

function leanToEdgeSnapTarget(node: LeanToExtensionNode): LeanToEdgeSnapTarget {
  return {
    leftEdgeX: node.position[0] - node.span / 2 - Math.max(0, node.leftOverhang),
    rightEdgeX: node.position[0] + node.span / 2 + Math.max(0, node.rightOverhang),
    roofEdgeY: node.position[1] + node.highEdgeHeight,
    pitch: node.pitch,
  }
}

export type LeanToSpanResizeSide = 'left' | 'right'

export type LeanToSpanResizeProposal = {
  span: number
  position: [number, number, number]
  highEdgeHeight: number
  lowEdgeHeight: number
  pitch: number
  target: LeanToEdgeSnapTarget | null
}

export function resolveLeanToSpanResizeProposal({
  node,
  wall,
  rawSpan,
  side,
  edgeSnapTargets = [],
  tolerance = LEAN_TO_EDGE_SNAP_TOLERANCE,
}: {
  node: LeanToExtensionNode
  wall: WallNode
  rawSpan: number
  side: LeanToSpanResizeSide
  edgeSnapTargets?: readonly LeanToEdgeSnapTarget[]
  tolerance?: number
}): LeanToSpanResizeProposal {
  const wallLength = getWallCurveLength(wall)
  const visualSign = side === 'right' ? 1 : -1
  const wallSign = Math.cos(node.rotation[1]) >= 0 ? visualSign : -visualSign
  const fixedStructuralEdge = node.position[0] - wallSign * (node.span / 2)
  const draggedOverhang = Math.max(0, wallSign > 0 ? node.rightOverhang : node.leftOverhang)
  const maximumSpan = Math.max(
    0.5,
    wallSign > 0
      ? wallLength - fixedStructuralEdge - draggedOverhang
      : fixedStructuralEdge - draggedOverhang,
  )
  const boundedSpan = Math.max(0.5, Math.min(maximumSpan, rawSpan))
  const centerX = fixedStructuralEdge + wallSign * (boundedSpan / 2)
  const draggedRoofEdge = centerX + wallSign * (boundedSpan / 2 + draggedOverhang)
  const wallEdgeX = wallSign > 0 ? wallLength : 0
  let best: { edgeX: number; distance: number; target: LeanToEdgeSnapTarget | null } = {
    edgeX: wallEdgeX,
    distance: Math.abs(draggedRoofEdge - wallEdgeX),
    target: null,
  }

  for (const target of edgeSnapTargets) {
    const edgeX = wallSign > 0 ? target.leftEdgeX : target.rightEdgeX
    const distance = Math.abs(draggedRoofEdge - edgeX)
    if (distance < best.distance || (Math.abs(distance - best.distance) <= 1e-9 && !best.target)) {
      best = { edgeX, distance, target }
    }
  }

  const snapped = best.distance <= tolerance
  const span = snapped
    ? Math.max(0.5, Math.min(maximumSpan, boundedSpan + wallSign * (best.edgeX - draggedRoofEdge)))
    : boundedSpan
  const position: [number, number, number] = [
    fixedStructuralEdge + wallSign * (span / 2),
    node.position[1],
    node.position[2],
  ]
  const target = snapped ? best.target : null
  const pitch = target?.pitch ?? node.pitch
  const highEdgeHeight = target ? target.roofEdgeY - node.position[1] : node.highEdgeHeight

  return {
    span,
    position,
    highEdgeHeight,
    lowEdgeHeight: leanToLowEdgeHeight({
      highEdgeHeight,
      pitch,
      projection: node.projection,
    }),
    pitch,
    target,
  }
}

function snapLeanToMoveCenterToEdges(
  node: LeanToExtensionNode,
  centerX: number,
  min: number,
  max: number,
  targets: readonly LeanToEdgeSnapTarget[],
): { centerX: number; target: LeanToEdgeSnapTarget } | null {
  const movingLeft = centerX - node.span / 2 - Math.max(0, node.leftOverhang)
  const movingRight = centerX + node.span / 2 + Math.max(0, node.rightOverhang)
  let best: { centerX: number; distance: number; target: LeanToEdgeSnapTarget } | null = null

  for (const target of targets) {
    const leftToRight = Math.abs(movingLeft - target.rightEdgeX)
    if (leftToRight <= LEAN_TO_EDGE_SNAP_TOLERANCE) {
      const snappedCenter = target.rightEdgeX + node.span / 2 + Math.max(0, node.leftOverhang)
      if (snappedCenter >= min && snappedCenter <= max) {
        best =
          !best || leftToRight < best.distance
            ? { centerX: snappedCenter, distance: leftToRight, target }
            : best
      }
    }

    const rightToLeft = Math.abs(movingRight - target.leftEdgeX)
    if (rightToLeft <= LEAN_TO_EDGE_SNAP_TOLERANCE) {
      const snappedCenter = target.leftEdgeX - node.span / 2 - Math.max(0, node.rightOverhang)
      if (snappedCenter >= min && snappedCenter <= max) {
        best =
          !best || rightToLeft < best.distance
            ? { centerX: snappedCenter, distance: rightToLeft, target }
            : best
      }
    }
  }

  return best ? { centerX: best.centerX, target: best.target } : null
}

export function resolveLeanToHighEdgeHeightSnap(
  node: LeanToExtensionNode,
  rawHighEdgeHeight: number,
  targets: readonly LeanToEdgeSnapTarget[],
  tolerance = LEAN_TO_HEIGHT_SNAP_TOLERANCE,
): LeanToHeightSnapMatch | null {
  const movingLeft = node.position[0] - node.span / 2 - Math.max(0, node.leftOverhang)
  const movingRight = node.position[0] + node.span / 2 + Math.max(0, node.rightOverhang)
  let best: { heightDelta: number; edgeDistance: number; target: LeanToEdgeSnapTarget } | null =
    null

  for (const target of targets) {
    const edgeDistance = Math.min(
      Math.abs(movingLeft - target.rightEdgeX),
      Math.abs(movingRight - target.leftEdgeX),
    )
    if (edgeDistance > LEAN_TO_EDGE_SNAP_TOLERANCE) continue

    const targetHeight = target.roofEdgeY - node.position[1]
    const heightDelta = Math.abs(targetHeight - rawHighEdgeHeight)
    if (heightDelta > tolerance) continue
    if (
      !best ||
      heightDelta < best.heightDelta - 1e-9 ||
      (Math.abs(heightDelta - best.heightDelta) <= 1e-9 && edgeDistance < best.edgeDistance)
    ) {
      best = { heightDelta, edgeDistance, target }
    }
  }

  return best
    ? {
        highEdgeHeight: best.target.roofEdgeY - node.position[1],
        target: best.target,
      }
    : null
}

export function resolveLeanToEdgeSnapTargets(
  node: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToEdgeSnapTarget[] {
  const wallLength = getWallCurveLength(wall)
  if (wallLength <= 1e-6) return []
  const wallChordLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (wallChordLength <= 1e-6) return []
  const wallDx = (wall.end[0] - wall.start[0]) / wallChordLength
  const wallDz = (wall.end[1] - wall.start[1]) / wallChordLength
  const sameSideSign = Math.sign(Math.cos(node.rotation[1])) || 1
  const targets: LeanToEdgeSnapTarget[] = []

  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'lean-to-extension' || candidate.id === node.id) continue
    const host = candidate.parentId ? nodes[candidate.parentId as AnyNodeId] : undefined
    if (host?.type !== 'wall') continue
    if (host.parentId !== wall.parentId) continue
    const hostLength = getWallCurveLength(host)
    if (hostLength <= 1e-6) continue
    const hostChordLength = Math.hypot(host.end[0] - host.start[0], host.end[1] - host.start[1])
    if (hostChordLength <= 1e-6) continue
    const hostDx = (host.end[0] - host.start[0]) / hostChordLength
    const hostDz = (host.end[1] - host.start[1]) / hostChordLength
    const parallel = wallDx * hostDx + wallDz * hostDz
    const candidateTarget = leanToEdgeSnapTarget(candidate)
    const candidatePose = leanToWallLocalPose(host, candidate, 0)

    if (parallel < 0.999) {
      const wallEnds = [
        { point: wall.start, x: 0, t: 0 },
        { point: wall.end, x: wallLength, t: 1 },
      ] as const
      const hostEnds = [
        { point: host.start, x: 0, t: 0 },
        { point: host.end, x: hostLength, t: 1 },
      ] as const
      for (const wallEnd of wallEnds) {
        for (const hostEnd of hostEnds) {
          if (
            Math.hypot(wallEnd.point[0] - hostEnd.point[0], wallEnd.point[1] - hostEnd.point[1]) >
            LEAN_TO_EDGE_SNAP_TOLERANCE
          ) {
            continue
          }
          const candidateReachesEnd =
            Math.min(
              Math.abs(candidateTarget.leftEdgeX - hostEnd.x),
              Math.abs(candidateTarget.rightEdgeX - hostEnd.x),
            ) <= LEAN_TO_EDGE_SNAP_TOLERANCE
          if (!candidateReachesEnd) continue
          const wallFrame = getWallCurveFrameAt(wall, wallEnd.t)
          const hostFrame = getWallCurveFrameAt(host, hostEnd.t)
          const candidateSideSign = Math.sign(Math.cos(candidate.rotation[1])) || 1
          const outwardDot =
            wallFrame.normal.x * sameSideSign * hostFrame.normal.x * candidateSideSign +
            wallFrame.normal.y * sameSideSign * hostFrame.normal.y * candidateSideSign
          if (outwardDot < -0.25) continue
          targets.push({
            leftEdgeX: wallEnd.x,
            rightEdgeX: wallEnd.x,
            roofEdgeY: candidateTarget.roofEdgeY,
            pitch: candidate.pitch,
            nodeId: candidate.id as AnyNodeId,
            anchor: [candidatePose.position[0], candidatePose.position[2]],
          })
        }
      }
      continue
    }
    if ((Math.sign(Math.cos(candidate.rotation[1])) || 1) !== sameSideSign) continue
    const offsetFromWall =
      (host.start[0] - wall.start[0]) * -wallDz + (host.start[1] - wall.start[1]) * wallDx
    if (Math.abs(offsetFromWall) > (wall.thickness ?? 0.1) + LEAN_TO_EDGE_SNAP_TOLERANCE) {
      continue
    }
    const hostStartX =
      (host.start[0] - wall.start[0]) * wallDx + (host.start[1] - wall.start[1]) * wallDz
    targets.push({
      leftEdgeX: hostStartX + candidateTarget.leftEdgeX,
      rightEdgeX: hostStartX + candidateTarget.rightEdgeX,
      roofEdgeY: candidateTarget.roofEdgeY,
      pitch: candidate.pitch,
      nodeId: candidate.id as AnyNodeId,
      anchor: [candidatePose.position[0], candidatePose.position[2]],
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

function evenlySpacedLoopXs(span: number, count: number): number[] {
  const resolvedCount = Math.max(3, Math.round(count))
  const step = span / resolvedCount
  return Array.from({ length: resolvedCount }, (_, index) => -span / 2 + index * step)
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
