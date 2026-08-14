import { LeanToExtensionNode, type WallNode } from '@pascal-app/core'
import { EAVE_TUCK_INWARD } from '../gutter/eave-snap'

export const MIN_LEAN_TO_POST_HEIGHT = 0.2
export const MIN_LEAN_TO_WALL_LENGTH = 0.6
export const LEAN_TO_EXTENSION_GEOMETRY_REVISION = 5

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
}

export function leanToLowEdgeHeight(
  node: Pick<LeanToExtensionNode, 'highEdgeHeight' | 'pitch' | 'projection'>,
): number {
  return node.highEdgeHeight - node.projection * Math.tan((node.pitch * Math.PI) / 180)
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
    rafterXs: evenlySpacedXs(span, rafterCount, node.rafterEndInset),
  }
}

export function resolveLeanToMoveCenterX(
  node: LeanToExtensionNode,
  wall: WallNode,
  rawLocalX: number,
  snapStep = 0,
): number {
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const snapped = snapStep > 0 ? Math.round(rawLocalX / snapStep) * snapStep : rawLocalX
  const min = node.span / 2 + Math.max(0, node.leftOverhang)
  const max = wallLength - node.span / 2 - Math.max(0, node.rightOverhang)
  return max < min ? wallLength / 2 : Math.max(min, Math.min(max, snapped))
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
  if (Math.abs(wall.curveOffset ?? 0) > 1e-6) return null
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
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
  return { ...parsed, lowEdgeHeight: leanToLowEdgeHeight(parsed) }
}

export function leanToWallLocalPose(
  wall: WallNode,
  node: LeanToExtensionNode,
  baseY: number,
): { position: [number, number, number]; rotationY: number } {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const [localX, localY, localZ] = node.position
  return {
    position: [
      wall.start[0] + localX * Math.cos(angle) - localZ * Math.sin(angle),
      baseY + localY,
      wall.start[1] + localX * Math.sin(angle) + localZ * Math.cos(angle),
    ],
    rotationY: -angle + node.rotation[1],
  }
}
