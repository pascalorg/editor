import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  getPlannedLinkedWallUpdates,
  planWallMoveJunctions,
  useScene,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'
import { isWallLongEnough, snapPointToGrid } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  buildBridgeWallCreates,
  getLinkedWallSnapshots,
  getWallsAfterUpdates,
  type LinkedWallSnapshot,
  stripWallIsNewMetadata,
} from './move-shared'

const GRID_STEP = 0.5

/**
 * 2D floor-plan move handler for wall.
 *
 * Mirrors the 3D `MoveWallTool` junction-plan behavior so dragging a
 * wall in the floor plan produces the same scene topology as dragging
 * it in 3D: linked corners cascade, same-direction collapsed walls
 * delete, off-axis branches stay rectilinear with a new bridge wall
 * inserted between the original and new corner.
 *
 * Tick (`apply`) — writes only updates while history is paused. Bridge
 * creates and wall deletes are deferred to commit so the live preview
 * doesn't churn the scene graph with create / delete on every cursor
 * move.
 *
 * Commit (`commit`) — runs after the overlay reverts to baseline and
 * resumes history. Recomputes the plan at the final cursor position
 * and emits one atomic `applyNodeChanges` covering the moved walls,
 * the bridge wall creates, and the collapsed wall deletes — so a
 * single Ctrl-Z rolls the entire operation back.
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

  let anchor: WallPlanPoint | null = null
  let lastDelta: WallPlanPoint = [0, 0]
  let lastNextStart: WallPlanPoint = originalStart
  let lastNextEnd: WallPlanPoint = originalEnd

  const session: FloorplanMoveTargetSession = {
    affectedIds: [wallId, ...linkedOriginals.map((w) => w.id as AnyNodeId)],

    apply({ planPoint, modifiers }) {
      const snapped: WallPlanPoint = modifiers.shiftKey
        ? [planPoint[0], planPoint[1]]
        : snapPointToGrid([planPoint[0], planPoint[1]] as WallPlanPoint, GRID_STEP)

      if (!anchor) {
        anchor = [snapped[0], snapped[1]]
        return
      }

      const dx = snapped[0] - anchor[0]
      const dz = snapped[1] - anchor[1]
      if (dx === lastDelta[0] && dz === lastDelta[1]) return
      lastDelta = [dx, dz]

      const nextStart: WallPlanPoint = [originalStart[0] + dx, originalStart[1] + dz]
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
          return { id: wall.id as AnyNodeId, data: { start: wall.start, end: wall.end } }
        }
        const planned = plannedById.get(wall.id)
        if (planned) {
          return { id: wall.id as AnyNodeId, data: { start: planned.start, end: planned.end } }
        }
        return { id: wall.id as AnyNodeId, data: { start: wall.start, end: wall.end } }
      })

      const sceneState = useScene.getState()
      sceneState.updateNodes([
        { id: wallId, data: { start: nextStart, end: nextEnd } },
        ...linkedUpdates,
      ])
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
      if (!liveWall || liveWall.type !== 'wall') return

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

      useViewer.getState().setSelection({ selectedIds: [wallId] })
    },
  }
  return session
}
