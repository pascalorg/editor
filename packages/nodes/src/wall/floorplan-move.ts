import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  getPlannedLinkedWallUpdates,
  planWallMoveJunctions,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'
import {
  getFloorplanWallThickness,
  getWallGridStep,
  isWallLongEnough,
  snapPointToGrid,
  useWallMoveGhosts,
  type WallMoveGhostBridge,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  buildBridgeWallCreates,
  buildBridgeWallPreviews,
  getLinkedWallSnapshots,
  getWallsAfterUpdates,
  type LinkedWallSnapshot,
  stripWallIsNewMetadata,
} from './move-shared'

/**
 * 2D floor-plan move handler for wall.
 *
 * Mirrors the 3D `MoveWallTool` junction-plan behavior so dragging a
 * wall in the floor plan produces the same scene topology as dragging
 * it in 3D: linked corners cascade, same-direction collapsed walls
 * delete, off-axis branches stay rectilinear with a new bridge wall
 * inserted between the original and new corner.
 *
 * Tick (`apply`) — publishes per-frame `{ start, end }` overrides to
 * `useLiveNodeOverrides` for the moved wall + every linked wall.
 * `useScene` stays at the pre-drag values throughout the drag; the
 * `WallSystem` and the 2D floor-plan layer fold the overrides in when
 * reading endpoints, so the visual preview updates without churning
 * zustand. Bridge creates and wall deletes are still deferred to
 * commit so the live preview doesn't churn the scene graph either.
 *
 * Commit (`commit`) — recomputes the plan at the final cursor position
 * and emits one atomic `applyNodeChanges` covering the moved walls,
 * the bridge wall creates, and the collapsed wall deletes — so a
 * single Ctrl-Z rolls the entire operation back. Clears the live
 * overrides after the write lands so the system reads from the new
 * committed scene state.
 *
 * Auto-slab live preview and ghost bridge SVG previews — visible in
 * the 3D tool — are deliberately deferred. Slab polygons re-derive on
 * commit through the normal scene reactions; bridges appear at commit
 * time. Follow-up work to surface them mid-drag is tracked separately.
 */
export const wallFloorplanMoveTarget: FloorplanMoveTarget<WallNode> = ({ node }) => {
  const wallId = node.id as AnyNodeId
  const originalStart: WallPlanPoint = [node.start[0], node.start[1]]
  const originalEnd: WallPlanPoint = [node.end[0], node.end[1]]
  const isNew = !!(node.metadata as { isNew?: unknown } | null)?.isNew

  const linkedOriginals: LinkedWallSnapshot[] = isNew
    ? []
    : getLinkedWallSnapshots({
        wallId: node.id,
        wallParentId: node.parentId ?? null,
        originalStart,
        originalEnd,
      })

  // Raw (un-snapped) cursor at drag start. Using the raw anchor lets the
  // wall start respond to every sub-step cursor movement: the resulting
  // wall position is rounded to absolute grid each tick, so the wall
  // lands on grid lines (instead of the previous "delta from snapped
  // anchor" path, which kept the wall at its original off-grid offset
  // and introduced a half-step dead-zone before the first jump).
  let rawAnchor: WallPlanPoint | null = null
  let lastDelta: WallPlanPoint = [0, 0]
  let lastNextStart: WallPlanPoint = originalStart
  let lastNextEnd: WallPlanPoint = originalEnd

  const session: FloorplanMoveTargetSession = {
    affectedIds: [wallId, ...linkedOriginals.map((w) => w.id as AnyNodeId)],

    apply({ planPoint, modifiers }) {
      if (!rawAnchor) {
        rawAnchor = [planPoint[0], planPoint[1]]
        return
      }

      const rawDx = planPoint[0] - rawAnchor[0]
      const rawDz = planPoint[1] - rawAnchor[1]

      // Snap the wall's start to the absolute grid (not the cursor
      // delta) so the wall actually lines up with grid lines, and the
      // wall jumps to a new grid position the moment the cursor crosses
      // the midpoint between two grid lines — no "half-step before
      // anything happens" lag.
      const step = getWallGridStep()
      const nextStart: WallPlanPoint = modifiers.shiftKey
        ? [originalStart[0] + rawDx, originalStart[1] + rawDz]
        : snapPointToGrid(
            [originalStart[0] + rawDx, originalStart[1] + rawDz] as WallPlanPoint,
            step,
          )

      const dx = nextStart[0] - originalStart[0]
      const dz = nextStart[1] - originalStart[1]
      if (dx === lastDelta[0] && dz === lastDelta[1]) return
      lastDelta = [dx, dz]

      const nextEnd: WallPlanPoint = [originalEnd[0] + dx, originalEnd[1] + dz]
      lastNextStart = nextStart
      lastNextEnd = nextEnd

      const plan = planWallMoveJunctions(
        linkedOriginals,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )
      const plannedUpdates = getPlannedLinkedWallUpdates(
        plan,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )
      const plannedById = new Map(plannedUpdates.map((entry) => [entry.id, entry]))

      // Walls in the plan that would collapse to ≈zero-length get held
      // at their pre-drag positions during the live preview — actually
      // deleting them is deferred to commit so a single drag tick
      // doesn't churn the scene graph with create / delete pairs.
      const collapsedIds = new Set([
        ...plannedUpdates
          .filter((entry) => !isWallLongEnough(entry.start, entry.end))
          .map((entry) => entry.id),
        ...plan.wallsToDelete.map((wall) => wall.id),
      ])

      const linkedUpdates = linkedOriginals.map((wall) => {
        if (collapsedIds.has(wall.id)) {
          return { id: wall.id as AnyNodeId, start: wall.start, end: wall.end }
        }
        const planned = plannedById.get(wall.id)
        if (planned) {
          return { id: wall.id as AnyNodeId, start: planned.start, end: planned.end }
        }
        return { id: wall.id as AnyNodeId, start: wall.start, end: wall.end }
      })

      // Publish endpoint overrides instead of writing to `useScene`.
      // `WallSystem` + the 2D layer + the sidebar panel all consult
      // `useLiveNodeOverrides` first, so the visual + numeric preview
      // updates each frame while zustand stays at the pre-drag values
      // until the user commits. Batched into a single zustand
      // notification — otherwise each per-wall `.set` would re-render
      // every override subscriber once per linked wall per tick.
      useLiveNodeOverrides.getState().setMany([
        [wallId, { start: nextStart, end: nextEnd }],
        ...linkedUpdates.map(
          (upd) =>
            [upd.id, { start: upd.start, end: upd.end }] as [string, Record<string, unknown>],
        ),
      ])

      // Surface bridge-wall previews so the floor-plan SVG layer can
      // render dashed outlines of what `commit()` will insert. Mirrors
      // the 3D `MoveWallTool`'s `ghostWallPreviews` mesh layer. The
      // `existingWalls` snapshot needs the post-drag layout so duplicate
      // detection works; we synthesise it from scene state + the
      // overrides we just published (zustand is still on baseline).
      const previewSceneWalls = getWallsAfterUpdates(useScene.getState().nodes, [
        { id: wallId, data: { start: nextStart, end: nextEnd } },
        ...linkedUpdates.map((u) => ({ id: u.id, data: { start: u.start, end: u.end } })),
      ]).filter((wall) => !collapsedIds.has(wall.id))
      const bridgePreviews = buildBridgeWallPreviews({
        bridgePlans: plan.bridgePlans,
        nextStart,
        nextEnd,
        existingWalls: previewSceneWalls,
      })
      const ghostBridges: WallMoveGhostBridge[] = bridgePreviews.map(({ ghost, wall }) => ({
        id: ghost.id,
        start: ghost.start,
        end: ghost.end,
        color: ghost.color,
        thickness: getFloorplanWallThickness(wall),
      }))
      useWallMoveGhosts.getState().setBridges(ghostBridges)

      // `WallSystem` only runs its rebuild pass when `dirtyNodes` is
      // non-empty. We're not writing to scene any more, but we still
      // need the system to pick up the live override changes — so
      // mark dirty here. The rebuild reads the effective endpoints
      // (override-merged) so the mesh follows the cursor.
      const sceneState = useScene.getState()
      sceneState.markDirty(wallId)
      for (const upd of linkedUpdates) {
        sceneState.markDirty(upd.id)
      }
    },

    canCommit() {
      const live = useScene.getState().nodes[wallId] as WallNode | undefined
      if (!live || live.type !== 'wall') return false
      const [dx, dz] = lastDelta
      return dx !== 0 || dz !== 0
    },

    commit() {
      const sceneState = useScene.getState()
      const liveWall = sceneState.nodes[wallId] as WallNode | undefined
      if (!liveWall || liveWall.type !== 'wall') {
        // Bail without leaving stale overrides behind.
        const overrides = useLiveNodeOverrides.getState()
        overrides.clear(wallId)
        for (const wall of linkedOriginals) overrides.clear(wall.id as AnyNodeId)
        return
      }

      const plan = planWallMoveJunctions(
        linkedOriginals,
        originalStart,
        originalEnd,
        lastNextStart,
        lastNextEnd,
      )
      const linkedWallUpdates = getPlannedLinkedWallUpdates(
        plan,
        originalStart,
        originalEnd,
        lastNextStart,
        lastNextEnd,
      )
      const collapsedLinkedWallIds = new Set([
        ...linkedWallUpdates
          .filter((entry) => !isWallLongEnough(entry.start, entry.end))
          .map((entry) => entry.id as AnyNodeId),
        ...plan.wallsToDelete.map((wall) => wall.id as AnyNodeId),
      ])

      const movingWallUpdate = {
        id: wallId,
        data: isNew
          ? {
              start: lastNextStart,
              end: lastNextEnd,
              metadata: stripWallIsNewMetadata(node.metadata),
            }
          : { start: lastNextStart, end: lastNextEnd },
      }

      const commitUpdates: Array<{ id: AnyNodeId; data: Partial<WallNode> }> = [
        movingWallUpdate,
        ...linkedWallUpdates
          .filter((entry) => !collapsedLinkedWallIds.has(entry.id as AnyNodeId))
          .map((entry) => ({
            id: entry.id as AnyNodeId,
            data: { start: entry.start, end: entry.end } as Partial<WallNode>,
          })),
      ]

      const existingWalls = getWallsAfterUpdates(sceneState.nodes, commitUpdates).filter(
        (wall) => !collapsedLinkedWallIds.has(wall.id as AnyNodeId),
      )
      const bridgeCreates = buildBridgeWallCreates({
        bridgePlans: plan.bridgePlans,
        nextStart: lastNextStart,
        nextEnd: lastNextEnd,
        existingWalls,
        wallCount: Object.values(sceneState.nodes).filter((entry) => entry?.type === 'wall').length,
      })

      sceneState.applyNodeChanges({
        update: commitUpdates as Array<{ id: AnyNodeId; data: Partial<AnyNode> }>,
        create: bridgeCreates,
        delete: Array.from(collapsedLinkedWallIds),
      })

      // Drop the live overrides now that the committed scene state
      // matches them — leaving them around would keep the system
      // double-merging the same values and would shadow any genuine
      // post-commit edits to start/end. Cleared synchronously so the
      // next frame reads the new scene state directly.
      const overrides = useLiveNodeOverrides.getState()
      overrides.clear(wallId)
      for (const wall of linkedOriginals) overrides.clear(wall.id as AnyNodeId)

      // Swap ghosts → real walls: the bridges we just created render
      // through the registry layer, so the dashed previews aren't
      // needed any more. Clearing here (instead of waiting for the
      // overlay's unmount cleanup) avoids a one-frame flash where
      // both ghosts and real bridges paint at the new position.
      useWallMoveGhosts.getState().clear()

      useViewer.getState().setSelection({ selectedIds: [wallId] })
    },
  }
  return session
}
