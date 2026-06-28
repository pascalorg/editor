import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  type WallNode,
  WallNode as WallNodeSchema,
  type WindowNode,
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
  const nodeId = node.id as AnyNodeId
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
    visible: true
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
  // Alt force-place (last apply's modifier) — lets `canCommit` allow an
  // overlapping placement, matching the 3D move.
  let forcePlace = false
  let liveTransformActive = useLiveTransforms.getState().transforms.has(nodeId)
  let liveOverrideKey: string | null = null
  let placementPreviewActive = usePlacementPreview.getState().node?.id === nodeId

  const setLiveOverride = (key: string, values: Record<string, unknown>) => {
    if (liveOverrideKey === key) return
    liveOverrideKey = key
    useLiveNodeOverrides.getState().set(nodeId, values)
  }

  // Move SFX — parity with the 3D `MoveWindowTool` (see `doorFloorplanMoveTarget`):
  // ONE soft `sfx:grid-snap` click each time the window's PLACED position crosses
  // a step. Keyed on the SNAPPED value, quantized by the live grid step in grid
  // mode else a gentle fixed cadence — grid mode ticks once per cell, lines/off
  // tick as the window moves.
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
        // Off any wall — free-follow. Click per grid cell over open floor.
        tickGridStep(resolvedPlanPoint[0], resolvedPlanPoint[1])
        freeFollow(resolvedPlanPoint)
        return
      }
      onWall = true
      if (placementPreviewActive) {
        usePlacementPreview.getState().clear()
        placementPreviewActive = false
      }

      // Figma-style along-wall alignment first (edge-to-edge with other
      // openings / wall ends), winning over the grid snap; falls back to grid
      // when nothing aligns. Follows the magnetic ("lines") mode; the grid
      // component lives in `snapToHalf` (mode-aware → raw when grid is off).
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
      const { clampedX, clampedY } = clampToWall(
        hit.wall,
        snappedLocalX,
        startLocalY,
        node.width,
        node.height,
      )

      // One click per real position step, keyed on the SNAPPED along-wall value
      // so it ticks only when the window actually moves to a new cell.
      tickGridStep(clampedX)

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
      // Off-wall the window is free-following — not placeable; the overlay
      // reverts to the pre-move snapshot. Matches the 3D move.
      if (!onWall || !lastValid) return false
      const live = useScene.getState().nodes[nodeId] as WindowNode | undefined
      if (live?.type !== 'window') return false
      // Block on overlap UNLESS Alt force-places — same `placeable` rule as
      // the 3D move + the shared `resolveOpeningPlacement`.
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
      // time but produces an empty diff (and silent revert) when the
      // committed move lands on the same `parentId` with identical data.
      // See `doorFloorplanMoveTarget.commit` for the original fix.
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
