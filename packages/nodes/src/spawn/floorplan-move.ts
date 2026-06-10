import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type SpawnNode,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'

export const spawnFloorplanMoveTarget: FloorplanMoveTarget<SpawnNode> = ({ node }) => {
  const spawnId = node.id as AnyNodeId
  const startY = node.position[1]
  const originalPosition: [number, number, number] = [...node.position]
  let lastPosition: [number, number, number] | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [spawnId],
    apply({ planPoint, modifiers }) {
      const step = getSegmentGridStep()
      const snap = (value: number) => (modifiers.shiftKey ? value : snapScalar(value, step))
      const next: [number, number, number] = [snap(planPoint[0]), startY, snap(planPoint[1])]

      if (lastPosition && lastPosition[0] === next[0] && lastPosition[2] === next[2]) return
      lastPosition = next
      useScene.getState().updateNodes([{ id: spawnId, data: { position: next } }])
    },
    canCommit() {
      if (!lastPosition) return false
      return lastPosition[0] !== originalPosition[0] || lastPosition[2] !== originalPosition[2]
    },
    commit() {
      if (!lastPosition) return
      useScene.getState().updateNodes([{ id: spawnId, data: { position: lastPosition } }])
    },
  }

  return session
}
