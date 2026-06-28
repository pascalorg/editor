import {
  type AnyNodeId,
  type DoorNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  type WallNode,
  WallNode as WallNodeSchema,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  snapToHalf,
  triggerSFX,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
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
  const nodeId = node.id as AnyNodeId
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
    visible: true
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
  // Alt force-place (last apply's modifier) — lets `canCommit` allow an
  // overlapping placement, matching the 3D move. Read in `canCommit` so an Alt-
  // held commit over a collision lands instead of reverting.
  let forcePlace = false
  let liveTransformActive = useLiveTransforms.getState().transforms.has(nodeId)
  let liveOverrideKey: string | null = null
  let placementPreviewActive = usePlacementPreview.getState().node?.id === nodeId

  const setLiveOverride = (key: string, values: Record<string, unknown>) => {
    if (liveOverrideKey === key) return
    liveOverrideKey = key
    useLiveNodeOverrides.getState().set(nodeId, values)
  }

  // Move SFX — parity with the 3D `MoveDoorTool`: ONE soft `sfx:grid-snap` click
  // each time the door's PLACED position crosses a step. Keyed on the SNAPPED
  // position, quantized by the live grid step in grid mode else a gentle fixed
  // cadence — so grid mode ticks once per cell (not on every micro mouse-move
  // while the door sits in a cell) while lines/off still tick as the door moves.
  const FREE_STEP_M = 0.1
  let lastStepKey: string | null = null
  const tickGridStep = (...coords: number[]) => {
    const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : FREE_STEP_M
    const key = coords.map((c) => Math.round(c / step)).join(',')
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
    if (liveTransformActive) {
      useLiveTransforms.getState().clear(nodeId)
      liveTransformActive = false
    }
    setLiveOverride('free-follow', { visible: false })
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
    placementPreviewActive = true
  }

  const session: FloorplanMoveTargetSession = {
    affectedIds: [nodeId],
    flipSide() {
      flipped = !flipped
      if (lastApply) this.apply(lastApply)
    },
    apply({ planPoint, modifiers }) {
      lastApply = { planPoint, modifiers }
      forcePlace = modifiers.altKey === true
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
      if (placementPreviewActive) {
        usePlacementPreview.getState().clear()
        placementPreviewActive = false
      }

      // Figma-style along-wall alignment first (edge-to-edge with other
      // openings / wall ends); it competes with — and wins over — the grid
      // snap. Follows the magnetic ("lines") mode; the grid component lives in
      // `snapToHalf` (mode-aware → raw when grid is off).
      const neighborX = !isMagneticSnapActive()
        ? null
        : snapLocalXToNeighbors({
            wall: hit.wall,
            localX: hit.localX,
            width: node.width,
            selfId: nodeId,
            nodes,
          })
      const snappedLocalX = neighborX ?? snapToHalf(hit.localX)
      const { clampedX, clampedY } = clampToWall(hit.wall, snappedLocalX, node.width, node.height)

      // One click per real position step, keyed on the SNAPPED along-wall value
      // so it ticks only when the door actually moves to a new cell.
      tickGridStep(clampedX)

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
        visible: true,
      }

      setLiveOverride(`wall:${hit.wall.id}:${side}`, {
        parentId: hit.wall.id,
        wallId: hit.wall.id,
        side,
        roofSegmentId: undefined,
        roofFace: undefined,
        visible: true,
      })
      useLiveTransforms.getState().set(nodeId, {
        position: lastValid.position,
        rotation: itemRotation,
      })
      liveTransformActive = true
    },
    canCommit() {
      // Off-wall the door is free-following in mid-air — not placeable. The
      // overlay then reverts to the pre-move snapshot (door returns to its
      // original wall), matching the 3D move where an open-floor click commits
      // nothing.
      if (!onWall || !lastValid) return false
      const live = useScene.getState().nodes[nodeId] as DoorNode | undefined
      if (live?.type !== 'door') return false
      // Block commit if the door overlaps another wall child — UNLESS Alt
      // force-places (same `placeable` rule as the 3D move + the shared
      // `resolveOpeningPlacement`).
      const collides = hasWallChildOverlap(
        lastValid.parentId,
        lastValid.position[0],
        lastValid.position[1],
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
          id: nodeId,
          data: lastValid,
        },
      ])
    },
  }

  return session
}
