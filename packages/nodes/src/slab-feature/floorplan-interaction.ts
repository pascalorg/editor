import {
  type FloorplanAffordance,
  type FloorplanMoveTarget,
  planSlabFeaturePlacement,
  resolveSlabFeaturePlacement,
  type SlabFeatureNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useInteractionScope, usePlacementPreview } from '@pascal-app/editor'
import { createSlabFeaturePlacementSession } from './placement'
import { clearSlabFeatureEditPreview, showSlabFeatureEditPreview } from './preview'

export const slabFeaturePlanMove: FloorplanMoveTarget<SlabFeatureNode> = ({ node, sceneApi }) => {
  if (!sceneApi) throw Error('Feature movement requires a scene API.')
  const session = createSlabFeaturePlacementSession(node, sceneApi, true)
  let valid = false
  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      useInteractionScope.getState().update({ view: '2d' })
      const proposal = session.update(planPoint, modifiers.altKey)
      valid = !!proposal?.placement
      usePlacementPreview.getState().set(valid ? proposal!.node : null)
    },
    canCommit: () => valid && session.ownsPreview(),
    commit() {
      session.commit()
    },
    cancel() {
      session.cancel()
    },
  }
}
export const slabFeaturePlanAffordance: FloorplanAffordance<SlabFeatureNode> = {
  interaction: 'resize',
  start({ node, payload, nodes, sceneApi, gridSnapStep }) {
    if (!sceneApi) throw Error('Feature editing requires a scene API.')
    const p = resolveSlabFeaturePlacement(nodes, node),
      action = (payload as { action: string }).action
    let patch: Partial<SlabFeatureNode> = {},
      valid = false
    const clear = () => {
      useLiveNodeOverrides.getState().clearFields(node.id, Object.keys(patch))
      clearSlabFeatureEditPreview(node.id)
    }
    return {
      affectedIds: [node.id],
      apply({ planPoint, modifiers }) {
        let [x, z] = planPoint
        if (!modifiers.altKey && isGridSnapActive() && gridSnapStep > 0) {
          x = Math.round(x / gridSnapStep) * gridSnapStep
          z = Math.round(z / gridSnapStep) * gridSnapStep
        }
        const candidate =
          action === 'width-start'
            ? { width: p.bounds.x1 - x, x: node.x + (x - p.bounds.x0) / 2 }
            : action === 'width-end'
              ? { width: x - p.bounds.x0, x: node.x + (x - p.bounds.x1) / 2 }
              : action === 'length-start'
                ? { length: p.bounds.z1 - z, z: node.z + (z - p.bounds.z0) / 2 }
                : { length: z - p.bounds.z0, z: node.z + (z - p.bounds.z1) / 2 }
        try {
          planSlabFeaturePlacement(sceneApi.nodes(), { ...node, ...candidate })
          patch = candidate
          valid = true
          useLiveNodeOverrides.getState().set(node.id, patch)
          showSlabFeatureEditPreview({ ...node, ...patch }, sceneApi)
        } catch {
          valid = Object.keys(patch).length > 0
        }
      },
      canCommit: () => valid,
      commit() {
        try {
          const latest = sceneApi.get(node.id)
          if (valid && latest?.type === 'slab-feature' && !useScene.getState().readOnly) {
            planSlabFeaturePlacement(sceneApi.nodes(), { ...latest, ...patch })
            sceneApi.update(node.id, patch)
          }
        } finally {
          clear()
        }
      },
      cancel: clear,
    }
  },
}
