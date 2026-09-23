import {
  type AnyNodeId,
  canPlaceFenceFeature,
  type FenceFeatureNode,
  type FenceNode,
  fenceFeatureData,
  fenceWithFeatures,
  type GridEvent,
  type SceneApi,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { pickFenceTarget } from './pick-target'

export function createFenceFeatureMoveSession(
  node: FenceFeatureNode,
  sceneApi: SceneApi,
  levelId: AnyNodeId | null,
  selectNode: (id: AnyNodeId) => void,
) {
  const affectedIds: AnyNodeId[] = [node.id]
  if (node.parentId) affectedIds.push(node.parentId as AnyNodeId)
  let target: ReturnType<typeof pickFenceTarget> = null
  const clear = () => {
    const overrides = useLiveNodeOverrides.getState()
    for (const id of affectedIds) {
      overrides.clearFields(id, id === node.id ? ['visible'] : ['features'])
      sceneApi.markDirty(id)
    }
  }
  return {
    affectedIds,
    clear,
    update(point: readonly [number, number], host?: FenceNode, ray?: GridEvent['localRay']) {
      clear()
      target = pickFenceTarget(point, host, ray, sceneApi, levelId)
      if (!target) return
      const nodes = sceneApi.nodes()
      const data = { ...fenceFeatureData(node), center: target.center }
      const fence = fenceWithFeatures(
        target.fence,
        (target.fence.children ?? []).map((id) => nodes[id as AnyNodeId]),
      )
      if (!canPlaceFenceFeature(fence, data)) {
        target = null
        return
      }
      if (!affectedIds.includes(target.fence.id)) affectedIds.push(target.fence.id)
      useLiveNodeOverrides.getState().set(node.id, { visible: false })
      useLiveNodeOverrides.getState().set(target.fence.id, { features: [data] })
      sceneApi.markDirty(node.id)
      for (const id of affectedIds) sceneApi.markDirty(id)
    },
    canCommit: () => target !== null,
    commit() {
      if (!target) return
      const destination = target
      clear()
      sceneApi.update(node.id, { parentId: destination.fence.id, center: destination.center })
      selectNode(node.id)
    },
  }
}
