import {
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type StairNode,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { applyFloorplanAlignment, getSegmentGridStep } from '@pascal-app/editor'

/**
 * 2D floor-plan move handler for stair.
 *
 * **Pivot semantics.** The stair's ORIGIN (its `position`) follows the
 * snapped cursor — the same pivot the 3D move tool (`shared/move-roof-tool`)
 * uses: it positions the stair by its origin at the grid-snapped, aligned
 * cursor, NOT by the grab offset under the mouse. This replaces the old
 * grab-relative delta so dragging in 2D tracks the same point as 3D.
 *
 * Figma alignment is layered on the origin point (single anchor), matching
 * `move-roof-tool`'s "align by origin" behaviour; Alt bypasses. Guides are
 * cleared by `FloorplanRegistryMoveOverlay`'s Path 1 teardown.
 *
 * The position is written straight to scene each tick (the stair has a real
 * `position` field, unlike polygon kinds) and re-applied atomically via
 * `commit()` so the overlay's deterministic revert → resume → commit path
 * records a single undo step (same pattern door / window use).
 */
export const stairFloorplanMoveTarget: FloorplanMoveTarget<StairNode> = ({ node, nodes }) => {
  const startY = node.position[1]
  // Alignment candidates gathered once — the scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, node.id)
  let lastValid: { position: [number, number, number] } | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      // Snap the origin to the editor's current grid step (driven by
      // `useEditor.gridSnapStep`). Shift bypasses the grid snap.
      const step = getSegmentGridStep()
      const gx = modifiers.shiftKey ? planPoint[0] : snapScalar(planPoint[0], step)
      const gz = modifiers.shiftKey ? planPoint[1] : snapScalar(planPoint[1], step)
      // Figma alignment on the origin point (Alt bypasses), matching the 3D
      // move tool. Publishes guides via `useAlignmentGuides`.
      const { point: aligned } = applyFloorplanAlignment(
        [gx, gz],
        [{ nodeId: node.id, kind: 'corner', x: gx, z: gz }],
        candidates,
        { bypass: modifiers.altKey },
      )
      const sx = aligned[0]
      const sz = aligned[1]

      if (lastValid && lastValid.position[0] === sx && lastValid.position[2] === sz) return
      lastValid = { position: [sx, startY, sz] }
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastValid }])
    },
    canCommit() {
      // No overlap / placement rules for stairs in 2D — any pointer-up
      // position commits, as long as we actually moved. Mirrors the 3D
      // move tool which also lets stairs land anywhere on the slab.
      return lastValid !== null
    },
    commit() {
      // Own the atomic write so the overlay takes the deterministic
      // commit-path (revert → resume → session.commit()). Same pattern
      // door / window use.
      if (!lastValid) return
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastValid }])
    },
  }

  return session
}
