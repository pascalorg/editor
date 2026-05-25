import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  type StairNode,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'

/**
 * 2D floor-plan move handler for stair — kicks in when the user clicks
 * "Move" on the stair action menu and the floor-plan view is active.
 * Stairs are free-floating on the slab (no wall anchor), so the apply
 * logic is just: pointer in plan space → snap to 0.5 m grid (Shift
 * bypasses) → write `position` via `useScene.updateNodes`.
 *
 * Routing through `floorplanMoveTarget` (instead of the overlay's
 * generic Path 2 translate) fixes two latent bugs the generic path
 * has for stair:
 *
 *   1. Path 2's `onPointerUp` bails when `event.target.closest(
 *      '[data-floorplan-scene]')` fails — which happens when the
 *      pointer-up lands on empty grid background (the SVG `<g>` only
 *      covers painted entries, so `target` resolves to the parent
 *      `<svg>` with no `[data-floorplan-scene]` ancestor). Path 1
 *      uses the overlay's bounding-rect check, which accepts any
 *      pointer inside the SVG viewport.
 *   2. Path 2 commits via a single `updateNode` call that has no
 *      "self-owned commit" hook, so the overlay's diff path can
 *      silently revert when the final state matches the snapshot.
 *      The `commit()` below mirrors door's pattern: take ownership
 *      of the atomic write so the deterministic
 *      revert → resume → `session.commit()` path runs.
 */
export const stairFloorplanMoveTarget: FloorplanMoveTarget<StairNode> = ({ node }) => {
  // Y stays put — stair's elevation is set by its parent level, not by
  // the 2D plan drag. Snapshot at start so apply() doesn't need to read
  // it from a possibly-mutated scene each tick.
  const startY = node.position[1]

  // Track the last successful placement so `commit()` can write it
  // atomically — see the comment on `commit` below.
  let lastValid: { position: [number, number, number] } | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const [sx, sz] = modifiers.shiftKey ? planPoint : snapPointToGrid(planPoint, 0.5)
      lastValid = { position: [sx, startY, sz] }
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastValid }])
    },
    canCommit() {
      // No overlap / placement rules for stairs in 2D — any pointer-up
      // position commits. Mirrors the 3D move tool which also lets
      // stairs land anywhere on the slab.
      return true
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
