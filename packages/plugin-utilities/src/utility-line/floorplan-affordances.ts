import {
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useEditor } from '@pascal-app/editor'
import { asNodeId } from '../kind-guards'
import { type UtilityLineNode, UtilityLineNode as UtilityLineSchema } from '../schema'
import { localToSitePlan, resolveFrame } from '../site-frame'

/**
 * Drag any vertex of a run in the 2D plan.
 *
 * Mirrors `moveSectionMarkerEndpointAffordance`: preview through
 * `useLiveNodeOverrides` while the pointer moves, ONE tracked write on
 * commit. The incoming `planPoint` is in the plan's own frame (building
 * local), so it is converted back to SITE metres before it touches `path`.
 * The vertex's ELEVATION is preserved — dragging in plan must not
 * accidentally un-bury a line.
 */
export const moveUtilityLineVertexAffordance: FloorplanAffordance<UtilityLineNode> = {
  start({ node, payload, nodes }): FloorplanAffordanceSession {
    const index = (payload as { index?: unknown }).index
    if (typeof index !== 'number' || index < 0 || index >= node.path.length) {
      return { affectedIds: [asNodeId(node.id)], apply() {}, canCommit: () => false }
    }
    const frame = resolveFrame(
      nodes as unknown as Record<string, Record<string, unknown>>,
      node as unknown as Record<string, unknown>,
    )
    const elevation = (node.path[index] as [number, number, number])[1]
    let latest: [number, number, number][] | null = null

    return {
      affectedIds: [asNodeId(node.id)],
      apply({ planPoint, modifiers }) {
        const step = modifiers.altKey || !isGridSnapActive() ? 0 : useEditor.getState().gridSnapStep
        const local: [number, number] =
          step > 0
            ? [Math.round(planPoint[0] / step) * step, Math.round(planPoint[1] / step) * step]
            : [planPoint[0], planPoint[1]]
        const [x, z] = localToSitePlan(frame, local)
        const path = node.path.map((point, i) =>
          i === index ? ([x, elevation, z] as [number, number, number]) : point,
        )
        if (!UtilityLineSchema.safeParse({ ...node, path }).success) {
          latest = null
          useLiveNodeOverrides.getState().clear(asNodeId(node.id))
          return
        }
        latest = path
        useLiveNodeOverrides.getState().set(asNodeId(node.id), { path })
      },
      canCommit: () => latest !== null,
      commit() {
        const path = latest
        useLiveNodeOverrides.getState().clear(asNodeId(node.id))
        if (path) useScene.getState().updateNode(asNodeId(node.id), { path })
      },
    }
  },
}
