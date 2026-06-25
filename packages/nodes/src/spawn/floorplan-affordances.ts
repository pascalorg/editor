import {
  type AnyNodeId,
  type FloorplanAffordance,
  type SpawnNode,
  useScene,
} from '@pascal-app/core'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

export const spawnRotateAffordance: FloorplanAffordance<SpawnNode> = {
  start({ node, initialPlanPoint }) {
    const spawnId = node.id as AnyNodeId
    const initialRotation = node.rotation ?? 0
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation = initialRotation

    return {
      affectedIds: [spawnId],
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        lastRotation = initialRotation - delta
        useScene.getState().updateNode(spawnId, { rotation: lastRotation })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(spawnId, { rotation: lastRotation })
      },
    }
  },
}
