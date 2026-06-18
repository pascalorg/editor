import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useLiveTransforms,
  useScene,
  type WallNode,
  WallNode as WallNodeSchema,
  type WindowNode,
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
import { clampToWall, DEFAULT_WINDOW_SILL_M, hasWallChildOverlap } from './window-math'

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
  // The level that owns the wall-snap candidates — resolves the wall-hosted,
  // roof-hosted, and fresh-placement parentings (see `getOpeningHostLevelId`).
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
    // Absolute: query the wall snap with the TRUE cursor (see the matching
    // comment in `doorFloorplanMoveTarget`). Relative mode anchored the search
    // to the original wall, which let the window snap to a farther wall across
    // a thin gap instead of the one under the cursor.
    mode: 'absolute',
  })

  // Preserve the source window's local Y — 2D move doesn't have a way
  // to express vertical motion, so we keep whatever vertical position
  // the window had when the move started. A fresh preset/catalog clone is
  // created at y=0, which would sit the window's centre on the floor (half
  // below ground); default those to a realistic sill so it floats above
  // the floor in 2D too. Same rule as the 3D `MoveWindowTool` (`getSillCenterY`).
  const startLocalY =
    node.position[1] > 0.1 ? node.position[1] : DEFAULT_WINDOW_SILL_M + node.height / 2

  // Track the last successful placement so `commit()` can write it
  // atomically — same deterministic-commit fix as `doorFloorplanMoveTarget`.
  let lastValid: {
    position: [number, number, number]
    rotation: [number, number, number]
    side: WindowNode['side']
    parentId: string
    wallId: string
    roofSegmentId: undefined
    roofFace: undefined
  } | null = null

  // R flips the window's facing (front ↔ back) mid-placement — see
  // `doorFloorplanMoveTarget`. `apply` re-derives the side each move, so the
  // flip is a persistent XOR plus a π rotation offset.
  let flipped = false
  let lastApply: {
    planPoint: readonly [number, number]
    modifiers: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }
  } | null = null
  // See `doorFloorplanMoveTarget`: off-wall the window free-follows the cursor
  // as a ghost and isn't committable (it needs a wall). Starts true.
  let onWall = true
  // Shift force-place (last apply's modifier) — lets `canCommit` allow an
  // overlapping placement, matching the 3D move.
  let forcePlace = false

  // Move SFX — parity with the 3D `MoveWindowTool` (see `doorFloorplanMoveTarget`):
  // ONE soft `sfx:grid-snap` click per grid step, identical free-following or on a
  // wall, keyed on the RAW cursor. No separate floor→wall cue (that was the
  // "double"). 2D `apply` runs once per pointermove, so the step-key dedup suffices.
  const STEP_M = 0.1
  let lastStepKey: string | null = null
  const tickGridStep = (...coords: number[]) => {
    const key = coords.map((c) => Math.round(c / STEP_M)).join(',')
    if (key !== lastStepKey) {
      lastStepKey = key
      triggerSFX('sfx:grid-snap')
    }
  }

  const freeFollow = (planPoint: readonly [number, number]) => {
    onWall = false
    lastValid = null
    if ((useScene.getState().nodes[node.id as AnyNodeId] as WindowNode | undefined)?.visible) {
      useScene.getState().updateNode(node.id as AnyNodeId, { visible: false })
    }
    const half = node.width / 2 + 0.5
    const wall = WallNodeSchema.parse({
      start: [planPoint[0] - half, planPoint[1]],
      end: [planPoint[0] + half, planPoint[1]],
      thickness: 0.1,
    })
    // Reflect the R-flip on the floating ghost so it faces the side that will
    // be committed (see `doorFloorplanMoveTarget.freeFollow`).
    const ghostSide: WindowNode['side'] = flipped
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
      position: [half, startLocalY, 0] as [number, number, number],
      rotation: [0, flipped ? Math.PI : 0, 0] as [number, number, number],
      visible: true,
    } as WindowNode
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
      // Drop any stale live transform left by the 3D `MoveWindowTool` — see
      // `doorFloorplanMoveTarget.apply`. Without this the 2D registry layer
      // keeps rendering the window at the 3D tool's last hover (it prefers
      // `useLiveTransforms` over the scene node for door/window), so the 2D
      // slide — which writes the scene node — wouldn't show. Guarded on
      // existence: `clear` allocates a new Map + re-renders.
      if (useLiveTransforms.getState().transforms.has(node.id as AnyNodeId)) {
        useLiveTransforms.getState().clear(node.id as AnyNodeId)
      }
      const nodes = useScene.getState().nodes
      const resolvedPlanPoint = resolveCursor(planPoint)
      const hit = findClosestWallInPlan(resolvedPlanPoint, nodes, startLevelId)
      if (!hit) {
        // Off any wall — free-follow. Click per grid cell over open floor.
        tickGridStep(resolvedPlanPoint[0], resolvedPlanPoint[1])
        freeFollow(resolvedPlanPoint)
        return
      }
      onWall = true
      usePlacementPreview.getState().clear()
      if ((nodes[node.id as AnyNodeId] as WindowNode | undefined)?.visible === false) {
        useScene.getState().updateNode(node.id as AnyNodeId, { visible: true })
      }

      // Figma-style along-wall alignment first (edge-to-edge with other
      // openings / wall ends), winning over the 0.5m grid snap; falls back
      // to grid when nothing aligns. Alt bypasses alignment; Shift bypasses all snap.
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
      const { clampedX, clampedY } = clampToWall(
        hit.wall,
        snappedLocalX,
        startLocalY,
        node.width,
        node.height,
      )

      // One click per grid step, keyed on the RAW along-wall cursor (`hit.localX`)
      // so the wall slide ticks at the same cadence as the off-wall ghost — same
      // SFX, no separate snap cue.
      tickGridStep(hit.localX)

      const side: WindowNode['side'] = flipped
        ? hit.side === 'front'
          ? 'back'
          : 'front'
        : hit.side
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

      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: lastValid,
        },
      ])
    },
    canCommit() {
      // Off-wall the window is free-following — not placeable; the overlay
      // reverts to the pre-move snapshot. Matches the 3D move.
      if (!onWall) return false
      const live = useScene.getState().nodes[node.id as AnyNodeId] as WindowNode | undefined
      if (!live || live.type !== 'window') return false
      // Block on overlap UNLESS Shift force-places — same `placeable` rule as
      // the 3D move + the shared `resolveOpeningPlacement`.
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
      // time but produces an empty diff (and silent revert) when the
      // committed move lands on the same `parentId` with identical data.
      // See `doorFloorplanMoveTarget.commit` for the original fix.
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
