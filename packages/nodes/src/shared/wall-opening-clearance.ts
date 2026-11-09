import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core'

const OVERLAP_EPSILON_M = 1e-5

export type WallOpeningClearance = {
  bottom: number
  id: AnyNodeId
  kind: 'door' | 'window'
  left: number
  right: number
  top: number
}

function isWallOpening(
  node: AnyNode | undefined,
): node is Extract<AnyNode, { type: 'door' | 'window' }> {
  return node?.type === 'door' || node?.type === 'window'
}

export function wallOpeningClearances(
  wall: WallNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): WallOpeningClearance[] {
  return (wall.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId])
    .filter(isWallOpening)
    .map((opening) => ({
      bottom: opening.position[1] - opening.height / 2,
      id: opening.id as AnyNodeId,
      kind: opening.type,
      left: opening.position[0] - opening.width / 2,
      right: opening.position[0] + opening.width / 2,
      top: opening.position[1] + opening.height / 2,
    }))
}

export function findWallOpeningConflicts({
  bottom,
  height,
  localX,
  nodes,
  wall,
  width,
}: {
  bottom: number
  height: number
  localX: number
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
  wall: WallNode
  width: number
}): AnyNodeId[] {
  const left = localX - width / 2
  const right = localX + width / 2
  const top = bottom + height

  return wallOpeningClearances(wall, nodes)
    .filter(
      (opening) =>
        left < opening.right - OVERLAP_EPSILON_M &&
        right > opening.left + OVERLAP_EPSILON_M &&
        bottom < opening.top - OVERLAP_EPSILON_M &&
        top > opening.bottom + OVERLAP_EPSILON_M,
    )
    .map((opening) => opening.id)
}
