import {
  type AnyNode,
  type LeanToExtensionNode,
  normalizeRoofSegmentTrim,
  type RoofSegmentTrim,
} from '@pascal-app/core'
import type { LeanToCornerSide } from './corner-joint'
import { resolveLeanToLayout } from './layout'

const ENDPOINT_TOLERANCE = 0.05
const PROFILE_TOLERANCE = 1e-4
const DIRECTION_TOLERANCE = 1e-6

export const FREESTANDING_CANOPY_JOINTS_KEY = 'leanToFreestandingCanopyJoints'

type PlanVector = readonly [number, number]

export type CanopySide = 'positive' | 'negative'

export type FreestandingCanopyJoint = {
  side: LeanToCornerSide
  kind: 'corner' | 'linear'
  neighborId: string
  neighborSide: LeanToCornerSide
  innerCanopySide: CanopySide
  interiorAngle: number
  trimX: number
  trimZ: number
  gutterMitre: number
  sharedPostOwner: boolean
}

export type CanopyRoofPlaneJointLayout = {
  centerX: number
  trim: RoofSegmentTrim
  width: number
}

export type CanopyGutterJointLayout = {
  joints: Partial<Record<LeanToCornerSide, FreestandingCanopyJoint & { gutterMitre: number }>>
  maxX: number
  minX: number
}

export type FreestandingCanopyJointMetadata = Partial<
  Record<
    LeanToCornerSide,
    Pick<
      FreestandingCanopyJoint,
      'kind' | 'innerCanopySide' | 'trimX' | 'trimZ' | 'gutterMitre' | 'sharedPostOwner'
    >
  >
>

export function canopyCornerJointMetadata(
  joints: Partial<Record<LeanToCornerSide, FreestandingCanopyJoint>>,
): FreestandingCanopyJointMetadata {
  const metadata: FreestandingCanopyJointMetadata = {}
  for (const [side, joint] of Object.entries(joints)) {
    if (!joint) continue
    metadata[side as LeanToCornerSide] = {
      kind: joint.kind,
      innerCanopySide: joint.innerCanopySide,
      trimX: joint.trimX,
      trimZ: joint.trimZ,
      gutterMitre: joint.gutterMitre,
      sharedPostOwner: joint.sharedPostOwner,
    }
  }
  return metadata
}

export function readFreestandingCanopyJointMetadata(
  leanTo: LeanToExtensionNode,
): FreestandingCanopyJointMetadata {
  const metadata = leanTo.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const value = (metadata as Record<string, unknown>)[FREESTANDING_CANOPY_JOINTS_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as FreestandingCanopyJointMetadata)
    : {}
}

function dot(a: PlanVector, b: PlanVector): number {
  return a[0] * b[0] + a[1] * b[1]
}

function runAxis(node: LeanToExtensionNode): PlanVector {
  return [Math.cos(node.rotation[1]), -Math.sin(node.rotation[1])]
}

function positiveCanopyAxis(node: LeanToExtensionNode): PlanVector {
  return [Math.sin(node.rotation[1]), Math.cos(node.rotation[1])]
}

function endpoint(node: LeanToExtensionNode, side: LeanToCornerSide): PlanVector {
  const axis = runAxis(node)
  const sign = side === 'left' ? -1 : 1
  return [
    node.position[0] + sign * axis[0] * (node.span / 2),
    node.position[2] + sign * axis[1] * (node.span / 2),
  ]
}

function inwardDirection(node: LeanToExtensionNode, side: LeanToCornerSide): PlanVector {
  const axis = runAxis(node)
  const sign = side === 'left' ? 1 : -1
  return [sign * axis[0], sign * axis[1]]
}

function distance(a: PlanVector, b: PlanVector): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function sameRoofProfile(a: LeanToExtensionNode, b: LeanToExtensionNode): boolean {
  return (
    a.canopyForm === b.canopyForm &&
    Math.abs(a.projection - b.projection) <= PROFILE_TOLERANCE &&
    Math.abs(a.highOverhang - b.highOverhang) <= PROFILE_TOLERANCE &&
    Math.abs(a.lowOverhang - b.lowOverhang) <= PROFILE_TOLERANCE &&
    Math.abs(a.highEdgeHeight - b.highEdgeHeight) <= PROFILE_TOLERANCE &&
    Math.abs(a.pitch - b.pitch) <= PROFILE_TOLERANCE &&
    Math.abs(a.roofThickness - b.roofThickness) <= PROFILE_TOLERANCE
  )
}

function matchingEndpoint(
  candidate: LeanToExtensionNode,
  point: PlanVector,
): { distance: number; side: LeanToCornerSide } | null {
  const matches = (['left', 'right'] as const)
    .map((side) => ({ distance: distance(endpoint(candidate, side), point), side }))
    .filter((match) => match.distance <= ENDPOINT_TOLERANCE)
    .sort((a, b) => a.distance - b.distance || a.side.localeCompare(b.side))
  return matches[0] ?? null
}

function jointAt(
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidate: LeanToExtensionNode,
  neighborSide: LeanToCornerSide,
): FreestandingCanopyJoint | null {
  const ownInward = inwardDirection(leanTo, side)
  const neighborInward = inwardDirection(candidate, neighborSide)
  const directionDot = Math.max(-1, Math.min(1, dot(ownInward, neighborInward)))
  const interiorAngle = Math.acos(directionDot)
  const layout = resolveLeanToLayout(leanTo)
  const trimZ = layout.projection + Math.max(0, leanTo.lowOverhang)
  if (interiorAngle >= Math.PI - DIRECTION_TOLERANCE) {
    return {
      side,
      kind: 'linear',
      neighborId: candidate.id,
      neighborSide,
      innerCanopySide: 'positive',
      interiorAngle: Math.PI,
      trimX: 0,
      trimZ,
      gutterMitre: 0,
      sharedPostOwner: String(leanTo.id) < String(candidate.id),
    }
  }
  if (interiorAngle <= DIRECTION_TOLERANCE) return null

  const bisectorLength = Math.hypot(
    ownInward[0] + neighborInward[0],
    ownInward[1] + neighborInward[1],
  )
  if (bisectorLength <= DIRECTION_TOLERANCE) return null
  const bisector: PlanVector = [
    (ownInward[0] + neighborInward[0]) / bisectorLength,
    (ownInward[1] + neighborInward[1]) / bisectorLength,
  ]
  const lateral = dot(bisector, positiveCanopyAxis(leanTo))
  if (Math.abs(lateral) <= DIRECTION_TOLERANCE) return null

  const trimX = Math.abs((dot(bisector, runAxis(leanTo)) / lateral) * trimZ)
  if (!Number.isFinite(trimX)) return null

  return {
    side,
    kind: 'corner',
    neighborId: candidate.id,
    neighborSide,
    innerCanopySide: lateral > 0 ? 'positive' : 'negative',
    interiorAngle,
    trimX,
    trimZ,
    gutterMitre: -(Math.PI - interiorAngle) / 2,
    sharedPostOwner: String(leanTo.id) < String(candidate.id),
  }
}

function compatibleCanopyCandidates(
  leanTo: LeanToExtensionNode,
  nodes: Record<string, AnyNode>,
) {
  return Object.values(nodes).filter(
    (candidate): candidate is LeanToExtensionNode =>
      candidate.type === 'lean-to-extension' &&
      candidate.id !== leanTo.id &&
      candidate.parentId === leanTo.parentId &&
      candidate.hostKind === 'freestanding' &&
      candidate.autoMiterCorners &&
      sameRoofProfile(leanTo, candidate),
  )
}

function rankedJointMatches(
  leanTo: LeanToExtensionNode,
  side: LeanToCornerSide,
  candidates: LeanToExtensionNode[],
) {
  const ownEndpoint = endpoint(leanTo, side)
  return candidates
    .flatMap((candidate) => {
      const match = matchingEndpoint(candidate, ownEndpoint)
      if (!match) return []
      const joint = jointAt(leanTo, side, candidate, match.side)
      return joint ? [{ candidate, joint, ...match }] : []
    })
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        String(a.candidate.id).localeCompare(String(b.candidate.id)) ||
        a.side.localeCompare(b.side),
    )
}

export function resolveFreestandingCanopyJoints(
  leanTo: LeanToExtensionNode,
  nodes: Record<string, AnyNode> | undefined,
): Partial<Record<LeanToCornerSide, FreestandingCanopyJoint>> {
  if (!nodes || leanTo.hostKind !== 'freestanding' || !leanTo.autoMiterCorners) return {}

  const candidates = compatibleCanopyCandidates(leanTo, nodes)
  const joints: Partial<Record<LeanToCornerSide, FreestandingCanopyJoint>> = {}

  for (const side of ['left', 'right'] as const) {
    const matches = rankedJointMatches(leanTo, side, candidates)
    for (const match of matches) {
      const reciprocal = rankedJointMatches(
        match.candidate,
        match.side,
        [
          ...compatibleCanopyCandidates(match.candidate, nodes),
          ...(sameRoofProfile(leanTo, match.candidate) ? [leanTo] : []),
        ],
      )[0]
      if (reciprocal?.candidate.id !== leanTo.id || reciprocal.side !== side) continue
      joints[side] = match.joint
      break
    }
  }

  return joints
}

export function resolveCanopyRoofPlaneJointLayout(
  leanTo: LeanToExtensionNode,
  nodes: Record<string, AnyNode> | undefined,
  planeSide: CanopySide,
): CanopyRoofPlaneJointLayout {
  const layout = resolveLeanToLayout(leanTo)
  const depth = layout.projection + Math.max(0, leanTo.lowOverhang)
  const joints = resolveFreestandingCanopyJoints(leanTo, nodes)
  const extensions = { left: 0, right: 0 }
  const baseTrims = { left: 0, right: 0 }
  const diagonals: Array<{
    edge: 'front' | 'back'
    segmentSide: LeanToCornerSide
    trimX: number
    trimZ: number
  }> = []
  const flipsX =
    (leanTo.canopyForm === 'gable' && planeSide === 'negative') ||
    (leanTo.canopyForm === 'butterfly' && planeSide === 'positive')
  const outerEdge = leanTo.canopyForm === 'gable' ? 'front' : 'back'

  for (const [side, joint] of Object.entries(joints) as [
    LeanToCornerSide,
    NonNullable<(typeof joints)[LeanToCornerSide]>,
  ][]) {
    const overhang = side === 'left' ? leanTo.leftOverhang : leanTo.rightOverhang
    const segmentSide = flipsX ? (side === 'left' ? 'right' : 'left') : side
    if (joint.kind === 'linear') {
      baseTrims[segmentSide] = overhang
      continue
    }
    const inside = joint.innerCanopySide === planeSide
    if (inside) {
      baseTrims[segmentSide] = overhang
    } else {
      const extension = joint.trimX - overhang
      if (extension >= 0) extensions[side] = extension
      else baseTrims[segmentSide] = -extension
    }
    diagonals.push({
      edge: inside ? outerEdge : outerEdge === 'front' ? 'back' : 'front',
      segmentSide,
      trimX: joint.trimX,
      trimZ: joint.trimZ,
    })
  }

  const width = layout.roofWidth + extensions.left + extensions.right
  const centerX = layout.roofCenterX + (extensions.right - extensions.left) / 2
  const trim = normalizeRoofSegmentTrim({ width, depth })
  trim.left = baseTrims.left
  trim.right = baseTrims.right
  for (const diagonal of diagonals) {
    const corner = `${diagonal.edge}${diagonal.segmentSide === 'left' ? 'Left' : 'Right'}` as const
    trim[`${corner}X`] = diagonal.trimX
    trim[`${corner}Z`] = diagonal.trimZ
  }
  return { centerX, trim, width }
}

export function resolveCanopyGutterJointLayout(
  leanTo: LeanToExtensionNode,
  nodes: Record<string, AnyNode> | undefined,
  planeSide: CanopySide,
): CanopyGutterJointLayout {
  const joints = resolveFreestandingCanopyJoints(leanTo, nodes)
  const resolvedJoints: CanopyGutterJointLayout['joints'] = {}
  let minX = -leanTo.span / 2 - leanTo.leftOverhang
  let maxX = leanTo.span / 2 + leanTo.rightOverhang

  for (const [side, joint] of Object.entries(joints) as [
    LeanToCornerSide,
    NonNullable<(typeof joints)[LeanToCornerSide]>,
  ][]) {
    const butterfly = leanTo.canopyForm === 'butterfly'
    const inside = joint.innerCanopySide === planeSide
    const endpointX = side === 'left' ? -leanTo.span / 2 : leanTo.span / 2
    const direction = side === 'left' ? -1 : 1
    const boundaryX = butterfly
      ? endpointX
      : endpointX + direction * (inside ? -joint.trimX : joint.trimX)
    if (side === 'left') minX = boundaryX
    else maxX = boundaryX
    resolvedJoints[side] = {
      ...joint,
      gutterMitre: inside || butterfly ? joint.gutterMitre : -joint.gutterMitre,
    }
  }

  return { joints: resolvedJoints, maxX, minX }
}
