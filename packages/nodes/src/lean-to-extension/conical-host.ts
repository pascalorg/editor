import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  LeanToExtensionNode,
  type RoofSegmentNode,
} from '@pascal-app/core'

const CONICAL_WALL_HIT_TOLERANCE = 0.15
const CONICAL_PLAN_HIT_TOLERANCE = 0.35

export type ConicalLeanToPlanHost = {
  segment: RoofSegmentNode
  center: [number, number]
  rotationY: number
  node: LeanToExtensionNode
}

export function isClosedLoopLeanTo(leanTo: Pick<LeanToExtensionNode, 'hostKind'>): boolean {
  return leanTo.hostKind === 'conical-roof'
}

export function isConicalLeanToHostOccupied(
  segmentId: RoofSegmentNode['id'],
  nodes: Record<AnyNodeId, AnyNode>,
): boolean {
  return Object.values(nodes).some(
    (node) =>
      node.type === 'lean-to-extension' &&
      node.hostKind === 'conical-roof' &&
      node.parentId === segmentId,
  )
}

export function resolveConicalLeanToPlacement(
  segment: RoofSegmentNode,
  source: Partial<LeanToExtensionNode> = {},
): LeanToExtensionNode | null {
  if (segment.roofType !== 'conical') return null

  const radius = segment.width / 2
  const hostHeightOffset = source.hostHeightOffset ?? 0
  const highEdgeHeight = Math.max(0.8, Math.min(10, segment.wallHeight + hostHeightOffset))
  const projection = source.projection ?? LeanToExtensionNode.shape.projection.parse(undefined)
  const pitch = source.pitch ?? LeanToExtensionNode.shape.pitch.parse(undefined)
  const lowEdgeHeight = highEdgeHeight - projection * Math.tan((pitch * Math.PI) / 180)

  const parsed = LeanToExtensionNode.parse({
    ...source,
    parentId: segment.id,
    hostKind: 'conical-roof',
    hostHeightOffset,
    position: [0, 0, radius],
    rotation: [0, 0, 0],
    span: 2 * Math.PI * radius,
    autoSpan: true,
    spanArcCenterZ: -radius,
    spanArcRadius: radius,
    highEdgeHeight,
    lowEdgeHeight,
    connectionMode: 'manual',
    leftEndCondition: 'joined',
    rightEndCondition: 'joined',
    autoMiterCorners: false,
    sideFlashing: false,
    leftOverhang: 0,
    rightOverhang: 0,
  })
  return {
    ...parsed,
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
  }
}

export function resolveConicalLeanToSurfaceHit(
  segment: RoofSegmentNode,
  localPosition: readonly [number, number, number],
  normal?: readonly [number, number, number],
): LeanToExtensionNode | null {
  if (segment.roofType !== 'conical' || !normal) return null
  const radius = segment.width / 2
  const radialDistance = Math.hypot(localPosition[0], localPosition[2])
  const hitsCylinderHeight =
    localPosition[1] >= -CONICAL_WALL_HIT_TOLERANCE &&
    localPosition[1] <= segment.wallHeight + CONICAL_WALL_HIT_TOLERANCE
  const hitsCylinderRadius = Math.abs(radialDistance - radius) <= CONICAL_WALL_HIT_TOLERANCE
  const hasHorizontalNormal = Math.abs(normal[1]) <= 0.35
  return hitsCylinderHeight && hitsCylinderRadius && hasHorizontalNormal
    ? resolveConicalLeanToPlacement(segment)
    : null
}

function resolveSegmentPlanPose(
  segment: RoofSegmentNode,
  nodes: Record<AnyNodeId, AnyNode>,
  activeLevelId: AnyNodeId,
): { center: [number, number]; rotationY: number } | null {
  if (findLevelAncestorId(segment.id as AnyNodeId, nodes) !== activeLevelId) return null

  const chain: AnyNode[] = []
  let current: AnyNode | undefined = segment
  const seen = new Set<AnyNodeId>()
  while (current && current.id !== activeLevelId && !seen.has(current.id as AnyNodeId)) {
    seen.add(current.id as AnyNodeId)
    chain.push(current)
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }

  let x = 0
  let z = 0
  let rotationY = 0
  for (const node of chain.reverse()) {
    if (node.type !== 'roof' && node.type !== 'roof-segment') continue
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)
    x += node.position[0] * cos + node.position[2] * sin
    z += -node.position[0] * sin + node.position[2] * cos
    rotationY += node.rotation
  }
  return { center: [x, z], rotationY }
}

export function findConicalLeanToHostInPlan(
  point: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
  activeLevelId: AnyNodeId,
  options?: { includeOccupied?: boolean },
): ConicalLeanToPlanHost | null {
  let closest: (ConicalLeanToPlanHost & { distance: number }) | null = null
  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'roof-segment' || candidate.roofType !== 'conical') continue
    if (!options?.includeOccupied && isConicalLeanToHostOccupied(candidate.id, nodes)) continue
    const pose = resolveSegmentPlanPose(candidate, nodes, activeLevelId)
    if (!pose) continue
    const distance = Math.hypot(point[0] - pose.center[0], point[1] - pose.center[1])
    if (distance > candidate.width / 2 + CONICAL_PLAN_HIT_TOLERANCE) continue
    if (closest && distance >= closest.distance) continue
    const node = resolveConicalLeanToPlacement(candidate)
    if (!node) continue
    closest = { segment: candidate, ...pose, node, distance }
  }
  if (!closest) return null
  const { distance: _distance, ...host } = closest
  return host
}
