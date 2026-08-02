import { type AnyNode, type AnyNodeId, getFloorStackedPosition, useScene } from '@pascal-app/core'

type FloorStackPreviewArgs = {
  node: AnyNode
  position: [number, number, number]
  rotation?: unknown
  levelId?: string | null
  nodes?: Record<AnyNodeId, AnyNode>
  /** Pointer-decided support cap — see `FloorPlacedElevationArgs.maxElevation`. */
  maxElevation?: number | null
}

export function getFloorStackPreviewPosition({
  node,
  position,
  rotation,
  levelId,
  nodes,
  maxElevation,
}: FloorStackPreviewArgs): [number, number, number] {
  return getFloorStackedPosition({
    node,
    nodes: nodes ?? useScene.getState().nodes,
    position,
    rotation,
    levelId,
    maxElevation,
  })
}
