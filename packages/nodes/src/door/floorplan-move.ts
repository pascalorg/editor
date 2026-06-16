import {
  type AnyNodeId,
  type DoorNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useLiveTransforms,
  useScene,
  type WallNode,
  WallNode as WallNodeSchema,
} from '@pascal-app/core'
import { snapToHalf, triggerSFX, usePlacementPreview } from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { getOpeningHostLevelId, getRoofHostedOpeningPlanPoint } from '../shared/roof-opening-host'
import {
  findClosestWallInPlan,
  projectWallLocalPointToPlan,
  resolveOpeningPlacement,
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
  // The level that owns the wall-snap candidates — resolves the wall-hosted,
  // roof-hosted, and fresh-placement parentings (see `getOpeningHostLevelId`).
  // Cached at start because the parent chain doesn't change during a move.
  const startLevelId = getOpeningHostLevelId(node, useScene.getState().nodes)
  const originalWall = node.parentId
    ? (useScene.getState().nodes[node.parentId as AnyNodeId] as WallNode | undefined)
    : undefined
  const resolveCursor = createFloorplanCursorResolver({
    original:
      originalWall?.type === 'wall'
        ? projectWallLocalPointToPlan(originalWall, node.position[0])
        : (getRoofHostedOpeningPlanPoint(node, useScene.getState().nodes) ?? [node.position[0], 0]),
    metadata: node.metadata,
    // Absolute: query the wall snap with the TRUE cursor, not the door's
    // original wall position plus a grab delta. A wall-hosted opening always
    // belongs to the wall nearest the cursor (the user's rule), and the 3D
    // move snaps on the wall literally under the ray — relative mode would
    // anchor the search to the old wall and resist hopping to a closer one
    // across a thin gap, picking the "far" wall the user reported. It also
    // makes the 2D Voronoi overlay (classified by cursor) predict the snap.
    mode: 'absolute',
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
    roofFace: undefined
  } | null = null

  // R flips the door's facing (front ↔ back) mid-placement. `apply` re-derives
  // the wall-facing side every move, so the flip is a persistent XOR applied on
  // top of the wall hit, plus a π rotation offset (matching the committed R).
  let flipped = false
  // Remember the last apply args so the overlay's R keydown can re-run `apply`
  // (which has no event of its own) to show the flip immediately.
  let lastApply: {
    planPoint: readonly [number, number]
    modifiers: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }
  } | null = null
  // Whether the cursor is currently over a wall. Off-wall the door free-follows
  // the cursor as a ghost (like the 3D move) and is NOT committable — a door
  // needs a wall. Starts true so a click before any move keeps the door put.
  let onWall = true
  // Shift force-place (last apply's modifier) — lets `canCommit` allow an
  // overlapping placement, matching the 3D move. Read in `canCommit` so a Shift-
  // held commit over a collision lands instead of reverting.
  let forcePlace = false

  // Move SFX — parity with the 3D `MoveDoorTool`: ONE soft `sfx:grid-snap` click
  // per grid step, identical free-following or sliding on a wall, keyed on the
  // RAW cursor (not the snapped along-wall value). No separate floor→wall cue —
  // that distinct sound was the "double" the user heard. 2D `apply` runs once per
  // pointermove, so the step-key dedup is sufficient (no per-frame guard needed).
  const STEP_M = 0.1
  let lastStepKey: string | null = null
  const tickGridStep = (...coords: number[]) => {
    const key = coords.map((c) => Math.round(c / STEP_M)).join(',')
    if (key !== lastStepKey) {
      lastStepKey = key
      triggerSFX('sfx:grid-snap')
    }
  }

  // Off-wall: float the faithful door symbol at the cursor (via a synthetic
  // wall fed to the placement-preview layer) and hide the real node, so the
  // ghost follows the cursor in 2D instead of the door staying frozen on its
  // old wall. Mirrors the fresh-placement free-follow.
  const freeFollow = (planPoint: readonly [number, number]) => {
    onWall = false
    lastValid = null
    if ((useScene.getState().nodes[node.id as AnyNodeId] as DoorNode | undefined)?.visible) {
      useScene.getState().updateNode(node.id as AnyNodeId, { visible: false })
    }
    const half = node.width / 2 + 0.5
    const wall = WallNodeSchema.parse({
      start: [planPoint[0] - half, planPoint[1]],
      end: [planPoint[0] + half, planPoint[1]],
      thickness: 0.1,
    })
    // Reflect the R-flip on the floating ghost so its swing-arc faces the side
    // that will be committed (the synthetic wall is plan-X aligned, so a back
    // facing is a π yaw; the symbol builder also reads `side`).
    const ghostSide: DoorNode['side'] = flipped
      ? node.side === 'front'
        ? 'back'
        : 'front'
      : node.side
    const ghost = {
      ...node,
      side: ghostSide,
      parentId: wall.id,
      wallId: wall.id,
      roofSegmentId: undefined,
      roofFace: undefined,
      position: [half, node.position[1], 0] as [number, number, number],
      rotation: [0, flipped ? Math.PI : 0, 0] as [number, number, number],
      visible: true,
    } as DoorNode
    usePlacementPreview.getState().set(ghost, wall)
  }

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    flipSide() {
      flipped = !flipped
      if (lastApply) this.apply(lastApply)
    },
    apply({ planPoint, modifiers }) {
      lastApply = { planPoint, modifiers }
      forcePlace = modifiers.shiftKey === true
      // Drop any stale live transform left by the 3D `MoveDoorTool` (it
      // publishes one on every wall hover). The 2D registry layer renders
      // door/window from `useLiveTransforms` IN PREFERENCE to the scene node,
      // but this 2D move writes the scene node — so a leftover 3D entry would
      // freeze the symbol on its wall and the slide wouldn't show. Only the
      // 2D path runs during an opening move (the panel gates the 3D tool's
      // events off via `!isOpeningMoveActive`), so nothing re-adds it. Guarded
      // on existence: `clear` always allocates a new Map + re-renders.
      if (useLiveTransforms.getState().transforms.has(node.id as AnyNodeId)) {
        useLiveTransforms.getState().clear(node.id as AnyNodeId)
      }
      const nodes = useScene.getState().nodes
      const resolvedPlanPoint = resolveCursor(planPoint)
      const hit = findClosestWallInPlan(resolvedPlanPoint, nodes, startLevelId)
      if (!hit) {
        // Off any wall — free-follow the cursor (not committable). Click per grid
        // cell as the ghost slides over open floor.
        tickGridStep(resolvedPlanPoint[0], resolvedPlanPoint[1])
        freeFollow(resolvedPlanPoint)
        return
      }
      // Back on a wall — drop the free-follow ghost + reveal the real node.
      onWall = true
      usePlacementPreview.getState().clear()
      if ((nodes[node.id as AnyNodeId] as DoorNode | undefined)?.visible === false) {
        useScene.getState().updateNode(node.id as AnyNodeId, { visible: true })
      }

      // Figma-style along-wall alignment first (edge-to-edge with other
      // openings / wall ends); it competes with — and wins over — the 0.5m
      // grid snap. Falls back to the grid snap when nothing aligns. Alt
      // bypasses alignment; Shift bypasses all snap.
      const neighborX =
        modifiers.altKey || modifiers.shiftKey
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

      // One click per grid step, keyed on the RAW along-wall cursor (`hit.localX`,
      // not the snapped value) so the wall slide ticks at the same cadence as the
      // off-wall ghost — the same SFX, no separate snap cue.
      tickGridStep(hit.localX)

      // Apply the R-flip on top of the wall-derived side.
      const side: DoorNode['side'] = flipped ? (hit.side === 'front' ? 'back' : 'front') : hit.side
      const itemRotation = hit.itemRotation + (flipped ? Math.PI : 0)

      lastValid = {
        position: [clampedX, clampedY, 0],
        rotation: [0, itemRotation, 0],
        side,
        parentId: hit.wall.id,
        wallId: hit.wall.id,
        // Re-anchoring to a wall ends any roof-segment hosting; the
        // overlay's snapshot restores it if the move is reverted.
        roofSegmentId: undefined,
        roofFace: undefined,
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
      // Off-wall the door is free-following in mid-air — not placeable. The
      // overlay then reverts to the pre-move snapshot (door returns to its
      // original wall), matching the 3D move where an open-floor click commits
      // nothing.
      if (!onWall) return false
      const live = useScene.getState().nodes[node.id as AnyNodeId] as DoorNode | undefined
      if (!live || live.type !== 'door') return false
      // Block commit if the door overlaps another wall child — UNLESS Shift
      // force-places (same `placeable` rule as the 3D move + the shared
      // `resolveOpeningPlacement`).
      const collides = hasWallChildOverlap(
        live.parentId as string,
        live.position[0],
        live.position[1],
        live.width,
        live.height,
        live.id,
      )
      return resolveOpeningPlacement({ collides, forcePlace }).placeable
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
