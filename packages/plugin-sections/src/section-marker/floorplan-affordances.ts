import {
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useEditor } from '@pascal-app/editor'
import { asNodeId } from '../kind-guards'
import { type SectionMarkerNode, SectionMarkerNode as SectionMarkerSchema } from '../schema'

/**
 * Drag either end of the cut line in the 2D plan. Mirrors
 * `moveConstructionDimensionWitnessAffordance`: preview through
 * `useLiveNodeOverrides` during the drag, one tracked write on commit.
 */
export const moveSectionMarkerEndpointAffordance: FloorplanAffordance<SectionMarkerNode> = {
  start({ node, payload }): FloorplanAffordanceSession {
    const endpoint = (payload as { endpoint?: unknown }).endpoint
    if (endpoint !== 'start' && endpoint !== 'end') {
      return { affectedIds: [asNodeId(node.id)], apply() {}, canCommit: () => false }
    }
    let latest: [number, number] | null = null
    return {
      affectedIds: [asNodeId(node.id)],
      apply({ planPoint, modifiers }) {
        const step = modifiers.altKey || !isGridSnapActive() ? 0 : useEditor.getState().gridSnapStep
        const point: [number, number] =
          step > 0
            ? [Math.round(planPoint[0] / step) * step, Math.round(planPoint[1] / step) * step]
            : [planPoint[0], planPoint[1]]
        const other = endpoint === 'start' ? node.end : node.start
        if (Math.hypot(point[0] - other[0], point[1] - other[1]) < 0.05) {
          latest = null
          useLiveNodeOverrides.getState().clear(asNodeId(node.id))
          return
        }
        const patch = { [endpoint]: point }
        if (!SectionMarkerSchema.safeParse({ ...node, ...patch }).success) {
          latest = null
          useLiveNodeOverrides.getState().clear(asNodeId(node.id))
          return
        }
        latest = point
        useLiveNodeOverrides.getState().set(asNodeId(node.id), patch)
      },
      canCommit: () => latest !== null,
      commit() {
        const point = latest
        useLiveNodeOverrides.getState().clear(asNodeId(node.id))
        if (point) useScene.getState().updateNode(asNodeId(node.id), { [endpoint]: point })
      },
    }
  },
}
