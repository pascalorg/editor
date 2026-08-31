import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type SpawnNode,
  snapScalar,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep, isGridSnapActive } from '@pascal-app/editor'

export const spawnFloorplanMoveTarget: FloorplanMoveTarget<SpawnNode> = ({ node }) => {
  const spawnId = node.id as AnyNodeId
  const startY = node.position[1]
  const originalPosition: [number, number, number] = [...node.position]
  let lastPosition: [number, number, number] | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [spawnId],
    apply({ planPoint }) {
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const snap = (value: number) => (step > 0 ? snapScalar(value, step) : value)
      const next: [number, number, number] = [snap(planPoint[0]), startY, snap(planPoint[1])]

      if (lastPosition && lastPosition[0] === next[0] && lastPosition[2] === next[2]) return
      lastPosition = next
      useLiveNodeOverrides.getState().set(spawnId, { position: next })
      useScene.getState().markDirty(spawnId)
    },
    canCommit() {
      if (!lastPosition) return false
      return lastPosition[0] !== originalPosition[0] || lastPosition[2] !== originalPosition[2]
    },
    commit() {
      if (!lastPosition) return
      useLiveNodeOverrides.getState().clear(spawnId)
      useScene.getState().updateNodes([{ id: spawnId, data: { position: lastPosition } }])
    },
  }

  return session
}
