import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanMoveTarget,
  type LeanToExtensionNode,
  useLiveNodeOverrides,
  type WallNode,
} from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'
import { resolveLeanToMoveCenterX } from './layout'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'

export const leanToFloorplanMoveTarget: FloorplanMoveTarget<LeanToExtensionNode> = ({
  node,
  sceneApi,
}) => {
  const nodeId = node.id as AnyNodeId
  const wall = node.parentId ? (sceneApi?.get(node.parentId as AnyNodeId) as WallNode) : undefined
  let lastPatch: Partial<LeanToExtensionNode> | null = null

  return {
    affectedIds: [nodeId],
    apply({ planPoint, modifiers }) {
      if (wall?.type !== 'wall' || !sceneApi) return
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const length = Math.max(1e-6, Math.hypot(dx, dz))
      const rawLocalX =
        ((planPoint[0] - wall.start[0]) * dx + (planPoint[1] - wall.start[1]) * dz) / length
      const step = modifiers.altKey ? 0 : getSegmentGridStep()
      const position: LeanToExtensionNode['position'] = [
        resolveLeanToMoveCenterX(node, wall, rawLocalX, step),
        node.position[1],
        node.position[2],
      ]
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const candidate = resolveLeanToEndAbutments(
        { ...node, position, autoSpan: false },
        wall,
        nodes,
      )
      const patch: Partial<LeanToExtensionNode> = {
        position,
        autoSpan: false,
        leftEndCondition: candidate.leftEndCondition,
        rightEndCondition: candidate.rightEndCondition,
        downspoutPosition: candidate.downspoutPosition,
      }
      useLiveNodeOverrides.getState().set(nodeId, patch)
      sceneApi.markDirty(nodeId)
      lastPatch = leanToPlacementConflicts(candidate, wall, nodes).length === 0 ? patch : null
    },
    canCommit: () => lastPatch !== null,
    commit() {
      if (!(lastPatch && sceneApi)) return
      useLiveNodeOverrides.getState().clear(nodeId)
      sceneApi.update(nodeId, lastPatch as Partial<AnyNode>)
    },
  }
}
