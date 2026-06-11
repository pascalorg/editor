import {
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingAlignmentAnchors,
  type StairNode,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { applyFloorplanAlignment, getSegmentGridStep } from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'

/**
 * 2D floor-plan move handler for stair.
 *
 * Existing stairs preserve the cursor grab offset, matching the 3D move
 * tools; fresh catalog placement follows the cursor absolutely.
 *
 * Figma alignment is layered on the stair footprint edges; Alt bypasses.
 * Guides are cleared by `FloorplanRegistryMoveOverlay`'s Path 1 teardown.
 *
 * The position is written straight to scene each tick (the stair has a real
 * `position` field, unlike polygon kinds) and re-applied atomically via
 * `commit()` so the overlay's deterministic revert → resume → commit path
 * records a single undo step (same pattern door / window use).
 */
export const stairFloorplanMoveTarget: FloorplanMoveTarget<StairNode> = ({ node, nodes }) => {
  const startY = node.position[1]
  const resolveCursor = createFloorplanCursorResolver({
    original: [node.position[0], node.position[2]],
    metadata: node.metadata,
  })
  // Alignment candidates gathered once — the scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, node.id)
  let lastValid: { position: [number, number, number] } | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      // Snap the origin to the editor's current grid step (driven by
      // `useEditor.gridSnapStep`). Shift bypasses the grid snap.
      const step = getSegmentGridStep()
      const snap = (value: number) => (modifiers.shiftKey ? value : snapScalar(value, step))
      const [gx, gz] = resolveCursor(planPoint, { snap })
      // Figma alignment on the actual stair footprint (Alt bypasses alignment; Shift all snap),
      // matching the 3D move tool. Publishes guides via `useAlignmentGuides`.
      const movingAnchors = movingAlignmentAnchors(node, nodes, gx, gz, node.rotation ?? 0)
      const { point: aligned } = applyFloorplanAlignment(
        [gx, gz],
        movingAnchors.length > 0
          ? movingAnchors
          : [{ nodeId: node.id, kind: 'corner', x: gx, z: gz }],
        candidates,
        { bypass: modifiers.altKey || modifiers.shiftKey },
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
