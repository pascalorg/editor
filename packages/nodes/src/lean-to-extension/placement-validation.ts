import type { AnyNode, AnyNodeId, LeanToExtensionNode, WallNode } from '@pascal-app/core'

const CLEARANCE = 0.05

function overlaps(aCenter: number, aWidth: number, bCenter: number, bWidth: number) {
  return Math.abs(aCenter - bCenter) < (aWidth + bWidth) / 2 + CLEARANCE
}

function planBounds(leanTo: LeanToExtensionNode, wall: WallNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.max(1e-6, Math.hypot(dx, dz))
  const along = [dx / length, dz / length] as const
  const side = Math.cos(leanTo.rotation[1]) >= 0 ? 1 : -1
  const outward = [-along[1] * side, along[0] * side] as const
  const center = [
    wall.start[0] + along[0] * leanTo.position[0],
    wall.start[1] + along[1] * leanTo.position[0],
  ] as const
  const halfSpan = leanTo.span / 2 + leanTo.sideOverhang
  const run = leanTo.projection + leanTo.eaveOverhang
  const points = [-halfSpan, halfSpan].flatMap((x) =>
    [0, run].map((z) => [
      center[0] + along[0] * x + outward[0] * z,
      center[1] + along[1] * x + outward[1] * z,
    ]),
  )
  return {
    minX: Math.min(...points.map((point) => point[0]!)),
    maxX: Math.max(...points.map((point) => point[0]!)),
    minZ: Math.min(...points.map((point) => point[1]!)),
    maxZ: Math.max(...points.map((point) => point[1]!)),
  }
}

function boundsOverlap(a: ReturnType<typeof planBounds>, b: ReturnType<typeof planBounds>) {
  return (
    a.minX < b.maxX - CLEARANCE &&
    a.maxX > b.minX + CLEARANCE &&
    a.minZ < b.maxZ - CLEARANCE &&
    a.maxZ > b.minZ + CLEARANCE
  )
}

export function leanToPlacementConflicts(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
): string[] {
  const conflicts: string[] = []
  for (const childId of wall.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (!child || child.id === leanTo.id) continue
    if (child.type === 'door' || child.type === 'window') {
      if (overlaps(leanTo.position[0], leanTo.span, child.position[0], child.width)) {
        conflicts.push(`${child.type} ${child.id}`)
      }
      continue
    }
    if (
      child.type === 'lean-to-extension' &&
      Math.cos(child.rotation[1]) * Math.cos(leanTo.rotation[1]) > 0 &&
      overlaps(leanTo.position[0], leanTo.span, child.position[0], child.span)
    ) {
      conflicts.push(`lean-to extension ${child.id}`)
    }
  }
  const candidateBounds = planBounds(leanTo, wall)
  for (const node of Object.values(nodes)) {
    if (node.type !== 'lean-to-extension' || node.id === leanTo.id || node.parentId === wall.id)
      continue
    const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    if (host?.type === 'wall' && boundsOverlap(candidateBounds, planBounds(node, host))) {
      conflicts.push(`adjacent extension ${node.id}`)
    }
  }
  return conflicts
}
