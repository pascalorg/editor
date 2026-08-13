import { LeanToExtensionNode, type WallNode } from '@pascal-app/core'

export const MIN_LEAN_TO_POST_HEIGHT = 0.2
export const MIN_LEAN_TO_WALL_LENGTH = 0.6

export type LeanToLayout = {
  span: number
  projection: number
  roofRun: number
  slopeLength: number
  pitchRadians: number
  effectivePitchDegrees: number
  highEdgeHeight: number
  lowEdgeHeight: number
  eaveEdgeHeight: number
  roofCenterY: number
  roofCenterZ: number
  rafterCenterY: number
  beamCenterY: number
  postHeight: number
  postXs: number[]
  rafterXs: number[]
}

export function resolveLeanToLayout(node: LeanToExtensionNode): LeanToLayout {
  const span = Math.max(0.5, node.span)
  const projection = Math.max(0.5, node.projection)
  const roofRun = projection + Math.max(0, node.eaveOverhang)
  const requestedPitch = (Math.max(1, Math.min(45, node.pitch)) * Math.PI) / 180
  const minimumLowEdge =
    MIN_LEAN_TO_POST_HEIGHT + node.beamHeight + node.rafterHeight + node.roofThickness / 2
  const maximumDrop = Math.max(0, node.highEdgeHeight - minimumLowEdge)
  const maximumPitch = Math.atan2(maximumDrop, projection)
  const pitchRadians = Math.min(requestedPitch, maximumPitch)
  const effectivePitchDegrees = (pitchRadians * 180) / Math.PI
  const lowEdgeHeight = node.highEdgeHeight - projection * Math.tan(pitchRadians)
  const eaveEdgeHeight = node.highEdgeHeight - roofRun * Math.tan(pitchRadians)
  const roofCenterY = node.highEdgeHeight - (roofRun * Math.tan(pitchRadians)) / 2
  const roofCenterZ = roofRun / 2
  const rafterCenterY = roofCenterY - (node.roofThickness + node.rafterHeight) / 2
  const beamTop = lowEdgeHeight - node.roofThickness / 2 - node.rafterHeight
  const beamCenterY = beamTop - node.beamHeight / 2
  const postHeight = Math.max(MIN_LEAN_TO_POST_HEIGHT, beamCenterY - node.beamHeight / 2)
  const postXs = evenlySpacedXs(span, node.postCount, node.postInset)
  const rafterCount = Math.max(node.postCount, Math.ceil(span / 1.2) + 1)

  return {
    span,
    projection,
    roofRun,
    slopeLength: roofRun / Math.max(0.001, Math.cos(pitchRadians)),
    pitchRadians,
    effectivePitchDegrees,
    highEdgeHeight: node.highEdgeHeight,
    lowEdgeHeight,
    eaveEdgeHeight,
    roofCenterY,
    roofCenterZ,
    rafterCenterY,
    beamCenterY,
    postHeight,
    postXs,
    rafterXs: evenlySpacedXs(span, rafterCount, 0),
  }
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

  return LeanToExtensionNode.parse({
    ...overrides,
    name: overrides.name ?? 'Lean-to Extension',
    parentId: wall.id,
    position: [localX, 0, positionZ],
    rotation: [0, rotationY, 0],
    span,
    highEdgeHeight: overrides.highEdgeHeight ?? Math.max(1.2, (wall.height ?? 2.4) - 0.1),
  })
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
