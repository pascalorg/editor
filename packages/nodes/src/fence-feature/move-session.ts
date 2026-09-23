import {
  type AnyNodeId,
  canPlaceFenceFeature,
  type FenceFeatureNode,
  type FenceNode,
  fenceFeatureData,
  fenceWithFeatures,
  type GridEvent,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { pickFenceTarget } from './pick-target'

export function createFenceFeatureMoveSession(node: FenceFeatureNode) {
  const affectedIds: AnyNodeId[] = [node.id]
  if (node.parentId) affectedIds.push(node.parentId as AnyNodeId)
  let target: ReturnType<typeof pickFenceTarget> = null
  const clear = () => {
    const overrides = useLiveNodeOverrides.getState()
    for (const id of affectedIds) {
      overrides.clearFields(id, id === node.id ? ['visible'] : ['features'])
      useScene.getState().markDirty(id)
    }
  }
  return {
    affectedIds,
    clear,
    update(point: readonly [number, number], host?: FenceNode, ray?: GridEvent['localRay']) {
      clear()
      target = pickFenceTarget(point, host, ray)
      if (!target) return
      const nodes = useScene.getState().nodes
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
      useScene.getState().markDirty(node.id)
      for (const id of affectedIds) useScene.getState().markDirty(id)
    },
    canCommit: () => target !== null,
    commit() {
      if (!target) return
      const destination = target
      clear()
      useScene
        .getState()
        .updateNode(node.id, { parentId: destination.fence.id, center: destination.center })
      useViewer.getState().setSelection({ selectedIds: [node.id] })
    },
  }
}
