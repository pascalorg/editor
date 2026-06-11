import {
  type AnyNodeId,
  type FloorplanAffordance,
  type SpawnNode,
  useScene,
} from '@pascal-app/core'

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
      apply({ planPoint }) {
        const currentAngle = Math.atan2(planPoint[1] - cz, planPoint[0] - cx)
        let delta = currentAngle - initialAngle
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
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
