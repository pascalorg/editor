import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { snapToHalf } from '@pascal-app/editor'
import { findClosestWallInPlan } from '../shared/wall-attach-target'
import { clampToWall, hasWallChildOverlap } from './window-math'

/**
 * 2D floor-plan move handler for window. Same shape as door (see
 * `nodes/src/door/floorplan-move.ts`) — pointer in plan space → snap
 * to nearest wall → project onto wall axis → snap local-X to 0.5m →
 * clamp inside wall bounds → commit.
 *
 * Window-specific: local Y (vertical position on the wall) is preserved
 * from the source node — we don't try to reposition the sill from a 2D
 * pointer (there's no Y signal in plan view). The 3D move tool handles
 * vertical motion; the 2D move is a horizontal-only re-anchor.
 */

export const windowFloorplanMoveTarget: FloorplanMoveTarget<WindowNode> = ({ node }) => {
  const startLevelId = (() => {
    const wall = useScene.getState().nodes[node.parentId as AnyNodeId]
    return wall ? (wall.parentId as AnyNodeId | null) : null
  })()

  // Preserve the source window's local Y — 2D move doesn't have a way
  // to express vertical motion, so we keep whatever vertical position
  // the window had when the move started.
  const startLocalY = node.position[1]

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint, modifiers }) {
      const nodes = useScene.getState().nodes
      const hit = findClosestWallInPlan(planPoint, nodes, startLevelId)
      if (!hit) return

      const snappedLocalX = modifiers.shiftKey ? hit.localX : snapToHalf(hit.localX)
      const { clampedX, clampedY } = clampToWall(
        hit.wall,
        snappedLocalX,
        startLocalY,
        node.width,
        node.height,
      )

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
      const live = useScene.getState().nodes[node.id as AnyNodeId] as WindowNode | undefined
      if (!live || live.type !== 'window') return false
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
  }

  return session
}
