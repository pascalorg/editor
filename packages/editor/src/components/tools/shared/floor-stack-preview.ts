import { type AnyNode, type AnyNodeId, getFloorStackedPosition, useScene } from '@pascal-app/core'

type FloorStackPreviewArgs = {
  node: AnyNode
  position: [number, number, number]
  rotation?: unknown
  levelId?: string | null
  nodes?: Record<AnyNodeId, AnyNode>
}

export function getFloorStackPreviewPosition({
  node,
  position,
  rotation,
  levelId,
  nodes,
}: FloorStackPreviewArgs): [number, number, number] {
  return getFloorStackedPosition({
    node,
    nodes: nodes ?? useScene.getState().nodes,
    position,
    rotation,
    levelId,
  })
}
