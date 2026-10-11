import {
  type AnyNodeId,
  canPlaceFenceFeature,
  type FenceFeatureNode,
  type FloorplanAffordance,
  fenceFeatureData,
  fenceWithFeatures,
  projectPointToFence,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

export const fenceFeatureAffordance: FloorplanAffordance<FenceFeatureNode> = {
  start({ node, payload, nodes }) {
    const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    const edge = (payload as { edge: 'start' | 'center' | 'end' }).edge
    let patch: Partial<FenceFeatureNode> = {}
    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        if (host?.type !== 'fence') return
        const distance = projectPointToFence(host, planPoint).center
        let center = distance
        let width = node.width
        if (edge !== 'center') {
          const fixed = node.center + ((edge === 'start' ? 1 : -1) * node.width) / 2
          if (edge === 'start' ? distance > fixed - 0.35 : distance < fixed + 0.35) return
          width = Math.abs(fixed - distance)
          center = (fixed + distance) / 2
        }
        const fence = fenceWithFeatures(
          host,
          (host.children ?? []).map((id) => nodes[id as AnyNodeId]).filter(Boolean),
        )
        if (!canPlaceFenceFeature(fence, { ...fenceFeatureData(node), center, width })) return
        patch = { center, width }
        useLiveNodeOverrides.getState().set(node.id, patch)
        useScene.getState().markDirty(node.id)
        useScene.getState().markDirty(host.id)
      },
      canCommit: () => Object.keys(patch).length > 0,
      commit() {
        useScene.getState().updateNode(node.id, patch)
        useLiveNodeOverrides.getState().clear(node.id)
      },
    }
  },
}
