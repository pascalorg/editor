import {
  ConstructionDimensionNode,
  type ConstructionDimensionNode as ConstructionDimensionNodeType,
  type FloorplanAffordance,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

export const moveConstructionDimensionBaselineAffordance: FloorplanAffordance<ConstructionDimensionNodeType> =
  {
    start({ node }) {
      let latest: [number, number] | null = null
      return {
        affectedIds: [node.id],
        apply({ planPoint }) {
          const origin: [number, number] = [planPoint[0], planPoint[1]]
          const baseline = { ...node.baseline, origin }
          if (!ConstructionDimensionNode.safeParse({ ...node, baseline }).success) return
          latest = origin
          useLiveNodeOverrides.getState().set(node.id, { baseline })
        },
        canCommit: () => latest !== null,
        commit() {
          useLiveNodeOverrides.getState().clear(node.id)
          if (latest) {
            useScene.getState().updateNode(node.id, {
              baseline: { ...node.baseline, origin: latest },
            })
          }
        },
      }
    },
  }
