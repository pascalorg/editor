import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanMoveTarget,
  isCurvedWall,
  type LeanToExtensionNode,
  sampleWallCenterline,
  useLiveNodeOverrides,
  type WallNode,
} from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'
import { resolveLeanToEdgeSnapTargets, resolveLeanToMoveCenterX } from './layout'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'

// Arc-length along the wall centerline to the point on it nearest the
// cursor. position[0] is measured as arc-length on a curved host, so the
// straight chord projection would drift the further the cursor is from the
// chord — sample the centerline polyline and walk it instead.
function arcLengthUnderPoint(wall: WallNode, planPoint: readonly [number, number]): number {
  const samples = sampleWallCenterline(wall)
  let bestDistanceSq = Number.POSITIVE_INFINITY
  let bestArcLength = 0
  let accumulated = 0
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!
    const b = samples[i + 1]!
    const dx = b.x - a.x
    const dz = b.y - a.y
    const segLengthSq = dx * dx + dz * dz
    const t =
      segLengthSq <= 1e-12
        ? 0
        : Math.max(
            0,
            Math.min(1, ((planPoint[0] - a.x) * dx + (planPoint[1] - a.y) * dz) / segLengthSq),
          )
    const px = a.x + dx * t
    const pz = a.y + dz * t
    const distanceSq = (planPoint[0] - px) ** 2 + (planPoint[1] - pz) ** 2
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestArcLength = accumulated + Math.sqrt(segLengthSq) * t
    }
    accumulated += Math.sqrt(segLengthSq)
  }
  return bestArcLength
}

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
      const rawLocalX = isCurvedWall(wall)
        ? arcLengthUnderPoint(wall, planPoint)
        : (() => {
            const dx = wall.end[0] - wall.start[0]
            const dz = wall.end[1] - wall.start[1]
            const length = Math.max(1e-6, Math.hypot(dx, dz))
            return ((planPoint[0] - wall.start[0]) * dx + (planPoint[1] - wall.start[1]) * dz) / length
          })()
      const step = modifiers.altKey ? 0 : getSegmentGridStep()
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const position: LeanToExtensionNode['position'] = [
        resolveLeanToMoveCenterX(
          node,
          wall,
          rawLocalX,
          step,
          modifiers.altKey ? [] : resolveLeanToEdgeSnapTargets(node, wall, nodes),
        ),
        node.position[1],
        node.position[2],
      ]
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
