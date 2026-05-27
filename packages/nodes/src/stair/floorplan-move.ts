import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type StairNode,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'

/**
 * 2D floor-plan move handler for stair — kicks in when the user clicks
 * "Move" on the stair action menu and the floor-plan view is active.
 *
 * **Delta-based motion, anchored on first pointermove.** The first
 * `apply` only captures `rawAnchor` — the cursor's pointer position the
 * instant the move begins — and skips writing to the scene. Subsequent
 * applies translate the stair's original position by the cursor's raw
 * delta and then snap the *absolute* result to the 0.5 m grid.
 *
 * Anchoring matters because the action-menu Move button portals to
 * `document.body`, so the move starts with the cursor wherever the menu
 * sits (often nowhere near the stair). The previous "position = snapped
 * cursor" implementation made the stair teleport to the menu's screen
 * position on the very first pointermove, which is the "drag doesn't
 * happen properly" symptom. Mirrors the same anchor pattern wall's
 * `floorplan-move.ts` uses.
 *
 * Snapping the absolute position (rather than the delta) keeps the
 * stair on the same 0.5 m grid the 3D StairTool placement and 3D
 * MoveRegistryNodeTool use — so dragging in 2D lands at the same
 * grid intersections you'd hit dragging in 3D.
 *
 * Routing through `floorplanMoveTarget` (instead of the overlay's
 * generic Path 2 translate) fixes two latent bugs the generic path
 * has for stair:
 *
 *   1. Path 2's `onPointerUp` bails when `event.target.closest(
 *      '[data-floorplan-scene]')` fails — which happens when the
 *      pointer-up lands on empty grid background. Path 1 uses the
 *      overlay's bounding-rect check, which accepts any pointer
 *      inside the SVG viewport.
 *   2. Path 2 commits via a single `updateNode` call that has no
 *      "self-owned commit" hook, so the overlay's diff path can
 *      silently revert when the final state matches the snapshot.
 *      The `commit()` below mirrors door's pattern: take ownership
 *      of the atomic write so the deterministic
 *      revert → resume → `session.commit()` path runs.
 */
export const stairFloorplanMoveTarget: FloorplanMoveTarget<StairNode> = ({ node }) => {
  // Capture the stair's original position once — apply() reads these
  // every tick instead of re-querying scene state (which would
  // double-apply our own writes).
  const originalX = node.position[0]
  const startY = node.position[1]
  const originalZ = node.position[2]

  let rawAnchor: [number, number] | null = null
  let lastValid: { position: [number, number, number] } | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      if (!rawAnchor) {
        rawAnchor = [planPoint[0], planPoint[1]]
        return
      }
      const rawDx = planPoint[0] - rawAnchor[0]
      const rawDz = planPoint[1] - rawAnchor[1]
      // Snap the absolute new position to the editor's current grid
      // step (the same one the cursor / draft snap to — driven by
      // `useEditor.gridSnapStep`). Hardcoding 0.5 here caused the stair
      // to snap to half-metre cells even when the user had set the grid
      // to a finer step like 0.1, so the cursor and the stair SVG
      // landed at different grid points. Shift bypasses snap entirely.
      const step = getSegmentGridStep()
      const rawX = originalX + rawDx
      const rawZ = originalZ + rawDz
      const sx = modifiers.shiftKey ? rawX : snapScalar(rawX, step)
      const sz = modifiers.shiftKey ? rawZ : snapScalar(rawZ, step)

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
      // commit-path (revert → resume → session.commit()). The dispatcher's
      // diff path would otherwise re-derive the final state by comparing
      // the post-apply scene to the snapshot — which produces an empty
      // diff (and silent revert) when the committed move happens to have
      // identical key/value pairs to the snapshot. Owning commit removes
      // that foot-gun. Same pattern door / window use.
      if (!lastValid) return
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastValid }])
    },
  }

  return session
}
