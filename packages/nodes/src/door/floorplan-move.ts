import {
  type AnyNodeId,
  type DoorNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useScene,
} from '@pascal-app/core'
import { snapToHalf } from '@pascal-app/editor'
import { findClosestWallInPlan, resolveOpeningPlacement } from '../shared/wall-attach-target'
import { clampToWall, hasWallChildOverlap } from './door-math'

/**
 * 2D floor-plan move handler for door — kicks in when the user clicks
 * "Move" on the door inspector (or action menu) and the floor-plan
 * view is active. Pointer in plan space → snap to nearest wall →
 * project onto wall axis → snap local-X to 0.5m grid → clamp inside
 * wall bounds → commit via `useScene.updateNodes`.
 *
 * Mirrors the 3D `move-tool.tsx` behaviour minus the R3F event plumbing:
 *   - Re-parents on transition between walls (parentId + wallId).
 *   - Adapts `side` + `rotation` from the wall normal under the pointer.
 *   - hasWallChildOverlap blocks committing overlapping placements.
 *
 * Curved walls are skipped by `findClosestWallInPlan` — same guardrail
 * as the 3D port and the legacy `DoorTool` / `MoveDoorTool`.
 */

export const doorFloorplanMoveTarget: FloorplanMoveTarget<DoorNode> = ({ node }) => {
  // Snapshot of the door's "valid" state at move-start — used by
  // canCommit to decide whether the current snapped position is OK.
  const startLevelId = (() => {
    // Walk up via parentId until we hit a node whose type isn't 'wall'
    // — that's the level (or null). The door is wall-hosted, so the
    // wall's parent is the level. Cached at start because the parent
    // chain doesn't change during a move.
    const wall = useScene.getState().nodes[node.parentId as AnyNodeId]
    return wall ? (wall.parentId as AnyNodeId | null) : null
  })()

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const nodes = useScene.getState().nodes
      const hit = findClosestWallInPlan(planPoint, nodes, startLevelId)
      if (!hit) return // pointer off any wall — keep door at last valid position

      // Snap the wall-local X to 0.5m grid (Shift bypasses).
      const snappedLocalX = modifiers.shiftKey ? hit.localX : snapToHalf(hit.localX)
      const { clampedX, clampedY } = clampToWall(hit.wall, snappedLocalX, node.width, node.height)

      // Build the updates atomically — position + rotation + side +
      // parentId + wallId in a single scene write. The current door's
      // parent might be a different wall; re-anchoring requires moving
      // the node in the parent's children list (the registry's
      // updateNode does this when parentId changes).
      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: {
            position: [clampedX, clampedY, 0],
            rotation: [0, hit.itemRotation, 0],
            side: hit.side,
            parentId: hit.wall.id,
            wallId: hit.wall.id,
          },
        },
      ])
    },
    canCommit() {
      const live = useScene.getState().nodes[node.id as AnyNodeId] as DoorNode | undefined
      if (!live || live.type !== 'door') return false
      // Block commit if the door overlaps any other wall child at its
      // current position. The 3D port has the same guard.
      const placement = resolveOpeningPlacement({
        collides: hasWallChildOverlap(
          live.parentId as string,
          live.position[0],
          live.position[1],
          live.width,
          live.height,
          live.id,
        ),
      })
      return placement.placeable
    },
  }

  return session
}
