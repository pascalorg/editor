import { type FloorplanMoveTargetSession, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { isGridSnapActive, useEditor } from '@pascal-app/editor'
import { asNodeId } from '../kind-guards'
import type { UtilityPoleNode } from '../schema'
import { type LooseNodes, localToSitePlan, resolveFrame } from '../site-frame'

/**
 * 2D move for a pole.
 *
 * `FloorplanMoveTarget` is the movingNode-driven path: the user picks Move on
 * the selected pole and the plan tracks the cursor until pointer-up
 * (`packages/core/src/registry/types.ts:807`). The generic fallback would
 * write the plan cursor straight into `position`, which is wrong here —
 * `position` is SITE metres and the plan is BUILDING-LOCAL, so an unclaimed
 * move would offset every pole by the building's own position.
 *
 * Preview through `useLiveNodeOverrides`, ONE tracked write on commit, same
 * shape as `moveUtilityLineVertexAffordance`. Any run linked to this pole
 * re-derives its endpoint from the override on every frame, so the drop
 * follows the pole live rather than after the drop.
 */
export function utilityPoleFloorplanMove({
  node,
  nodes,
}: {
  node: UtilityPoleNode
  nodes: Readonly<Record<string, unknown>>
}): FloorplanMoveTargetSession {
  const frame = resolveFrame(
    nodes as unknown as LooseNodes,
    node as unknown as Record<string, unknown>,
  )
  const buttY = node.position[1]
  let latest: [number, number, number] | null = null

  return {
    affectedIds: [asNodeId(node.id)],
    apply({ planPoint, modifiers }) {
      const step = modifiers.altKey || !isGridSnapActive() ? 0 : useEditor.getState().gridSnapStep
      const local: [number, number] =
        step > 0
          ? [Math.round(planPoint[0] / step) * step, Math.round(planPoint[1] / step) * step]
          : [planPoint[0], planPoint[1]]
      const [x, z] = localToSitePlan(frame, local)
      // The butt elevation is preserved — a plan move must not re-seat a pole.
      latest = [x, buttY, z]
      useLiveNodeOverrides.getState().set(asNodeId(node.id), { position: latest })
    },
    canCommit: () => latest !== null,
    commit() {
      const position = latest
      useLiveNodeOverrides.getState().clear(asNodeId(node.id))
      if (position) useScene.getState().updateNode(asNodeId(node.id), { position } as never)
    },
  }
}
