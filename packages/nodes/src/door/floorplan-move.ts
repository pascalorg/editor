import {
  type AnyNodeId,
  type DoorNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { snapToHalf } from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import {
  getRoofHostedOpeningLevelId,
  getRoofHostedOpeningPlanPoint,
} from '../shared/roof-opening-host'
import {
  findClosestWallInPlan,
  projectWallLocalPointToPlan,
  snapLocalXToNeighbors,
} from '../shared/wall-attach-target'
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
    // Wall-hosted: the wall's parent is the level. Roof-hosted: walk
    // segment → roof → level. Cached at start because the parent chain
    // doesn't change during a move.
    const nodes = useScene.getState().nodes
    const roofLevelId = getRoofHostedOpeningLevelId(node, nodes)
    if (roofLevelId) return roofLevelId
    const wall = nodes[node.parentId as AnyNodeId]
    return wall ? (wall.parentId as AnyNodeId | null) : null
  })()
  const originalWall = node.parentId
    ? (useScene.getState().nodes[node.parentId as AnyNodeId] as WallNode | undefined)
    : undefined
  const resolveCursor = createFloorplanCursorResolver({
    original:
      originalWall?.type === 'wall'
        ? projectWallLocalPointToPlan(originalWall, node.position[0])
        : (getRoofHostedOpeningPlanPoint(node, useScene.getState().nodes) ?? [
            node.position[0],
            0,
          ]),
    metadata: node.metadata,
  })

  // Track the last successful placement so `commit()` can write it
  // atomically — see the comment on `commit` below for why we don't
  // rely on the dispatcher's diff path.
  let lastValid: {
    position: [number, number, number]
    rotation: [number, number, number]
    side: DoorNode['side']
    parentId: string
    wallId: string
    roofSegmentId: undefined
  } | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const nodes = useScene.getState().nodes
      const resolvedPlanPoint = resolveCursor(planPoint)
      const hit = findClosestWallInPlan(resolvedPlanPoint, nodes, startLevelId)
      if (!hit) return // pointer off any wall — keep door at last valid position

      // Figma-style along-wall alignment first (edge-to-edge with other
      // openings / wall ends); it competes with — and wins over — the 0.5m
      // grid snap. Falls back to the grid snap when nothing aligns. Alt
      // bypasses; Shift drops the grid snap for fine positioning.
      const neighborX = modifiers.altKey
        ? null
        : snapLocalXToNeighbors({
            wall: hit.wall,
            localX: hit.localX,
            width: node.width,
            selfId: node.id as AnyNodeId,
            nodes,
          })
      const snappedLocalX = neighborX ?? (modifiers.shiftKey ? hit.localX : snapToHalf(hit.localX))
      const { clampedX, clampedY } = clampToWall(hit.wall, snappedLocalX, node.width, node.height)

      lastValid = {
        position: [clampedX, clampedY, 0],
        rotation: [0, hit.itemRotation, 0],
        side: hit.side,
        parentId: hit.wall.id,
        wallId: hit.wall.id,
        // Re-anchoring to a wall ends any roof-segment hosting; the
        // overlay's snapshot restores it if the move is reverted.
        roofSegmentId: undefined,
      }

      // Build the updates atomically — position + rotation + side +
      // parentId + wallId in a single scene write. The current door's
      // parent might be a different wall; re-anchoring requires moving
      // the node in the parent's children list (the registry's
      // updateNode does this when parentId changes).
      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: lastValid,
        },
      ])
    },
    canCommit() {
      const live = useScene.getState().nodes[node.id as AnyNodeId] as DoorNode | undefined
      if (!live || live.type !== 'door') return false
      // Block commit if the door overlaps any other wall child at its
      // current position. The 3D port has the same guard.
      const overlapping = hasWallChildOverlap(
        live.parentId as string,
        live.position[0],
        live.position[1],
        live.width,
        live.height,
        live.id,
      )
      return !overlapping
    },
    commit() {
      // Own the atomic write so the overlay takes the deterministic
      // commit-path (revert → resume → session.commit()). The dispatcher's
      // diff path would otherwise re-derive the final state by comparing
      // the post-apply scene to the snapshot — that works most of the
      // time, but produces an empty diff (and silent revert) when the
      // committed move happens to land on the same `parentId` AND has
      // been re-applied with identical data. Owning commit removes that
      // foot-gun without forcing the dispatcher to track per-key writes.
      if (!lastValid) return
      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: lastValid,
        },
      ])
    },
  }

  return session
}
