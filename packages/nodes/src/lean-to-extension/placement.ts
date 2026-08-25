import {
  type AnyNode,
  type AnyNodeId,
  getLevelElevations,
  LeanToExtensionNode,
  type SlabNode,
  type WallNode,
} from '@pascal-app/core'
import { findClosestWallAttachmentInPlan } from '../shared/wall-attach-target'
import {
  LEAN_TO_CORNER_JOINTS_KEY,
  leanToCornerJointMetadata,
  resolveLeanToCornerJoints,
} from './corner-joint'
import { leanToLowEdgeHeight, resolveLeanToPlanCenter, resolveLeanToWallPlacement } from './layout'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'
import {
  applyLeanToAvailableWallSpan,
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  clearLeanToRoofAttachment,
  resolveLeanToRoofAttachment,
} from './roof-attachment'

export type LeanToPlanPlacementTarget = {
  node: LeanToExtensionNode
  valid: boolean
  wall?: WallNode
}

export function resolveLeanToCommitTarget<T>(
  visibleTarget: T | null,
  clickTarget: T | null,
): T | null {
  return visibleTarget ?? clickTarget
}

/** Apply transient corner data so the placement ghost matches the committed assembly. */
export function resolveLeanToPreviewNode(
  node: LeanToExtensionNode,
  wall: WallNode | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToExtensionNode {
  if (!wall) return node
  const joints = resolveLeanToCornerJoints(node, wall, nodes)
  if (Object.keys(joints).length === 0) return node
  return {
    ...node,
    leftEndCondition: joints.left ? 'joined' : node.leftEndCondition,
    rightEndCondition: joints.right ? 'joined' : node.rightEndCondition,
    metadata: {
      ...(node.metadata && typeof node.metadata === 'object' ? node.metadata : {}),
      [LEAN_TO_CORNER_JOINTS_KEY]: leanToCornerJointMetadata(joints),
    },
  }
}

export function resolveLeanToWallPlanTarget(
  wall: WallNode,
  localX: number,
  side: 'front' | 'back',
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToPlanPlacementTarget | null {
  const wallPlacement = resolveLeanToWallPlacement(wall, localX, side)
  if (!wallPlacement) return null

  const attachment = resolveLeanToRoofAttachment(wallPlacement, wall, nodes)
  const autoSpannedNode = attachment
    ? applyLeanToRoofAttachment(wallPlacement, attachment)
    : applyLeanToWallAutoSpan(clearLeanToRoofAttachment(wallPlacement), wall)
  const attachedNode = applyLeanToAvailableWallSpan(
    autoSpannedNode,
    wall,
    nodes,
    wallPlacement.position[0],
  )
  const node = resolveLeanToEndAbutments(attachedNode, wall, nodes)
  const previewNode = resolveLeanToPreviewNode(node, wall, nodes)
  return {
    node: previewNode,
    valid: leanToPlacementConflicts(node, wall, nodes).length === 0,
    wall,
  }
}

const PLACEMENT_ROTATION_STEP = Math.PI / 4

export function nextLeanToPlacementRotation(
  current: number,
  key: string,
  hasShortcutModifier = false,
): number {
  if (hasShortcutModifier) return current
  const direction = key === 'r' || key === 'R' ? 1 : key === 't' || key === 'T' ? -1 : 0
  if (direction === 0) return current
  return (Math.round(current / PLACEMENT_ROTATION_STEP) + direction) * PLACEMENT_ROTATION_STEP
}

export function resolveLeanToPlanPosition(
  node: LeanToExtensionNode,
  point: readonly [number, number],
): LeanToExtensionNode['position'] {
  const [centerX, centerZ] = resolveLeanToPlanCenter(node)
  const rotationY = node.rotation[1]
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [
    point[0] - centerX * cos - centerZ * sin,
    node.position[1],
    point[1] + centerX * sin - centerZ * cos,
  ]
}

export function resolveLeanToFreestandingPlacement(
  levelId: string,
  point: readonly [number, number],
  rotationY = 0,
): LeanToExtensionNode {
  const parsed = LeanToExtensionNode.parse({
    name: 'Freestanding Lean-to Canopy',
    parentId: levelId,
    hostKind: 'freestanding',
    highSideMode: 'independent-high-beam',
    connectionMode: 'manual',
    autoSpan: false,
    position: [0, 0, 0],
    rotation: [0, rotationY, 0],
  })
  return {
    ...parsed,
    position: resolveLeanToPlanPosition(parsed, point),
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
  }
}

export function resolveLeanToPlanPlacement({
  activeLevelId,
  freestandingPoint,
  freestandingRotationY = 0,
  nodes,
  point,
}: {
  activeLevelId: AnyNodeId
  freestandingPoint: readonly [number, number]
  freestandingRotationY?: number
  nodes: Record<AnyNodeId, AnyNode>
  point: readonly [number, number]
}): LeanToPlanPlacementTarget {
  const hit = findClosestWallAttachmentInPlan(point, nodes, activeLevelId)
  if (hit) {
    const target = resolveLeanToWallPlanTarget(hit.wall, hit.localX, hit.side, nodes)
    if (target) return target
  }

  const slabAttached = findLeanToSlabEdgePlacement(point, nodes, activeLevelId)
  if (slabAttached) return { node: slabAttached, valid: true }

  return {
    node: resolveLeanToFreestandingPlacement(
      activeLevelId,
      freestandingPoint,
      freestandingRotationY,
    ),
    valid: true,
  }
}

export function resolveLeanToSlabEdgePlacement({
  activeLevelId,
  edgeIndex,
  edgeT,
  nodes,
  slab,
}: {
  activeLevelId: string
  edgeIndex: number
  edgeT: number
  nodes: Record<AnyNodeId, AnyNode>
  slab: SlabNode
}): LeanToExtensionNode | null {
  const activeLevel = getLevelElevations(nodes).get(activeLevelId)
  const hostLevel = slab.parentId ? getLevelElevations(nodes).get(slab.parentId) : undefined
  if (!(activeLevel && hostLevel && activeLevel.buildingId === hostLevel.buildingId)) return null

  const start = slab.polygon[edgeIndex]
  const end = slab.polygon[(edgeIndex + 1) % slab.polygon.length]
  if (!(start && end)) return null
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const edgeLength = Math.hypot(dx, dz)
  if (edgeLength < 0.6) return null

  const t = Math.max(0, Math.min(1, edgeT))
  const area = slab.polygon.reduce((sum, point, index) => {
    const next = slab.polygon[(index + 1) % slab.polygon.length]!
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
  const winding = area >= 0 ? 1 : -1
  const outwardX = (winding * dz) / edgeLength
  const outwardZ = (-winding * dx) / edgeLength
  const highEdgeHeight = hostLevel.baseY - activeLevel.baseY + slab.elevation - slab.thickness
  if (highEdgeHeight < 0.8 || highEdgeHeight > 10) return null

  const parsed = LeanToExtensionNode.parse({
    name: 'Slab-attached Lean-to Canopy',
    parentId: activeLevelId,
    hostKind: 'slab-edge',
    hostSlabId: slab.id,
    hostSlabEdgeIndex: edgeIndex,
    hostSlabEdgeT: t,
    highSideMode: 'wall-ledger',
    connectionMode: 'manual',
    autoSpan: true,
    span: Math.max(0.5, edgeLength - 0.1),
    position: [start[0] + dx * t, 0, start[1] + dz * t],
    rotation: [0, Math.atan2(outwardX, outwardZ), 0],
    highEdgeHeight,
  })
  return {
    ...parsed,
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
    lowEdgeHeight: leanToLowEdgeHeight(parsed),
  }
}

export function findLeanToSlabEdgePlacement(
  point: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
  activeLevelId: string,
  maxDistance = 0.35,
): LeanToExtensionNode | null {
  let best: { distance: number; node: LeanToExtensionNode } | null = null
  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'slab' || candidate.recessed || candidate.polygon.length < 2) continue
    for (let edgeIndex = 0; edgeIndex < candidate.polygon.length; edgeIndex++) {
      const start = candidate.polygon[edgeIndex]!
      const end = candidate.polygon[(edgeIndex + 1) % candidate.polygon.length]!
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const lengthSq = dx * dx + dz * dz
      if (lengthSq <= 1e-9) continue
      const edgeT = Math.max(
        0,
        Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq),
      )
      const edgeX = start[0] + dx * edgeT
      const edgeZ = start[1] + dz * edgeT
      const distance = Math.hypot(point[0] - edgeX, point[1] - edgeZ)
      if (distance > maxDistance || (best && distance >= best.distance)) continue
      const node = resolveLeanToSlabEdgePlacement({
        activeLevelId,
        edgeIndex,
        edgeT,
        nodes,
        slab: candidate,
      })
      if (node) best = { distance, node }
    }
  }
  return best?.node ?? null
}

export function reconcileLeanToSlabEdgePlacement(
  node: LeanToExtensionNode,
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToExtensionNode {
  if (
    node.hostKind !== 'slab-edge' ||
    !node.parentId ||
    !node.hostSlabId ||
    node.hostSlabEdgeIndex === undefined ||
    node.hostSlabEdgeT === undefined
  ) {
    return node
  }
  const slab = nodes[node.hostSlabId as AnyNodeId]
  if (slab?.type !== 'slab') return node
  const resolved = resolveLeanToSlabEdgePlacement({
    activeLevelId: node.parentId,
    edgeIndex: node.hostSlabEdgeIndex,
    edgeT: node.hostSlabEdgeT,
    nodes,
    slab,
  })
  if (!resolved) return node
  const highEdgeHeight = resolved.highEdgeHeight + node.hostHeightOffset
  return {
    ...node,
    position: resolved.position,
    rotation: resolved.rotation,
    span: node.autoSpan ? resolved.span : node.span,
    highEdgeHeight,
    lowEdgeHeight: leanToLowEdgeHeight({ ...node, highEdgeHeight }),
    highSideMode: 'wall-ledger',
    connectionMode: 'manual',
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
  }
}

export function moveLeanToAlongSlabEdge(
  node: LeanToExtensionNode,
  point: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
): LeanToExtensionNode | null {
  if (node.hostKind !== 'slab-edge' || !node.hostSlabId || node.hostSlabEdgeIndex === undefined) {
    return null
  }
  const slab = nodes[node.hostSlabId as AnyNodeId]
  if (slab?.type !== 'slab') return null
  const start = slab.polygon[node.hostSlabEdgeIndex]
  const end = slab.polygon[(node.hostSlabEdgeIndex + 1) % slab.polygon.length]
  if (!(start && end)) return null
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq <= 1e-9) return null
  const hostSlabEdgeT = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq),
  )
  return reconcileLeanToSlabEdgePlacement({ ...node, hostSlabEdgeT }, nodes)
}
