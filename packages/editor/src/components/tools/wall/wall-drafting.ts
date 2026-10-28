import {
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  finishWallEdit,
  generateId,
  planSeparatorInsertion,
  planWallInsertion,
  planWallSplitAtPoint,
  railingWallDefaults,
  resolveWallConstruction,
  runAsSingleSceneHistoryStep,
  type SeparatorNode,
  sameWallConstruction,
  snapPointAlongAngleRay,
  useScene,
  type WallConstructionOptions,
  type WallNode,
  wallsRunAlong,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import { getDrawnWallTypes, getWallLineKind } from '../../../lib/wall-draw-variant'
import useEditor, { getActiveSnappingMode, isMagneticSnapActive } from '../../../store/use-editor'
import {
  distanceSquared,
  findWallBodySnapTarget,
  findWallSnapTarget,
  findWallSpecialPointSnap,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
  wallIdsAtSnapPoint,
} from './wall-snap-geometry'

// The pure snap geometry lives in `./wall-snap-geometry`; re-exported here so
// existing importers (fence drafting, the editor barrel) keep their paths.
export {
  chainEndJoinsExistingWall,
  findWallSnapTarget,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapKind,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
} from './wall-snap-geometry'

export const WALL_GRID_STEP = 0.5
export const WALL_MIN_LENGTH = 0.01

export function getSegmentGridStep(): number {
  // A 0 step means "no grid lattice" — every grid-snap consumer guards on
  // `step <= 0` and returns the raw value, so disabling grid here suppresses
  // the lattice for walls, fences, and every node move/affordance that reads
  // this choke point, without retuning their snap math.
  return resolveSnapFlags(getActiveSnappingMode()).grid ? useEditor.getState().gridSnapStep : 0
}

export function snapScalarToGrid(value: number, step = WALL_GRID_STEP): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function snapPointToGrid(point: WallPlanPoint, step = WALL_GRID_STEP): WallPlanPoint {
  return [snapScalarToGrid(point[0], step), snapScalarToGrid(point[1], step)]
}

export function resolveEndpointWallSplit(args: {
  point: WallPlanPoint
  /** Level the moved wall lives on — only its walls are split candidates. */
  levelId: string | null
  /** The moved wall + every wall receiving an endpoint update in the same commit. */
  ignoreWallIds: string[]
  /**
   * Capture radius. The endpoint already snapped onto the wall body during
   * the drag, so the tight connect radius (drop genuinely on the wall) is
   * the default.
   */
  radius?: number
}): WallPlanPoint | null {
  const { point, levelId, ignoreWallIds, radius = WALL_CONNECT_SNAP_RADIUS } = args
  const { nodes, applyNodeChanges } = useScene.getState()
  const result = planWallSplitAtPoint(nodes, {
    point,
    levelId: levelId as AnyNodeId | null,
    ignoreWallIds,
    radius,
  })
  if (!result.ok) return null
  const { plan } = result
  if (
    plan.changes.create.length > 0 ||
    plan.changes.update.length > 0 ||
    plan.changes.delete.length > 0
  ) {
    applyNodeChanges(plan.changes)
  }
  return plan.point
}

type SnapWallDraftArgs = {
  point: WallPlanPoint
  walls: WallNode[]
  start?: WallPlanPoint
  angleSnap?: boolean
  ignoreWallIds?: string[]
  bypassSnap?: boolean
  /** Override the grid step. */
  step?: number
  /**
   * Magnetic snapping to existing wall geometry (corners, midpoints,
   * crossings, wall bodies). When `false`, only grid/angle snap applies and
   * `snap` is always `null`. Defaults to `true` so callers that don't care
   * keep the prior behaviour.
   */
  magnetic?: boolean
  /**
   * Optional grid-snap override, in the caller's plan frame. When omitted,
   * falls back to the building-local grid at `step` — the lattice the wall
   * tools draft on, square to the house however the building is turned.
   */
  gridSnap?: (point: WallPlanPoint) => WallPlanPoint
  /** Optional magnetic snap radii. Omitted means wall tools keep their defaults. */
  snapRadii?: WallSnapRadii
  /**
   * The point is a wall end (drawn or dragged): in the non-magnetic modes an
   * end aimed into another wall's drawn body, or within the connect radius of
   * either face, lands on that wall's reference line — where the wall
   * topology T-joins it — ahead of the grid / angle placement, keeping the
   * segment's direction from `start` (see `findWallBodySnapTarget`). Without
   * it the grid quantises an end aimed at a face to the nearest lattice point,
   * a fraction short of the face, and the end stays open with a gap.
   */
  captureWallBodies?: boolean
  /**
   * The walls `captureWallBodies` may join an end into; `walls` when omitted.
   * A body capture T-joins the wall, so a caller that adds reference walls it
   * can't join (the floor below) keeps them out of this list while they still
   * serve the corner and edge snaps.
   */
  bodyWalls?: WallNode[]
}

export function snapWallDraftPointDetailed(args: SnapWallDraftArgs): WallDraftSnapResult {
  const {
    point,
    walls,
    start,
    angleSnap = false,
    ignoreWallIds,
    bypassSnap = false,
    step: overrideStep,
    magnetic = true,
    gridSnap,
    snapRadii,
    captureWallBodies = false,
    bodyWalls = walls,
  } = args

  if (bypassSnap) return { point, snap: null, targetWallIds: [] }

  // Discrete special points (corner / midpoint / crossing) are taken from the
  // raw cursor so an interim grid snap can't mask them. A corner always wins,
  // then the nearer of midpoint / crossing — see `findWallSpecialPointSnap`.
  if (magnetic) {
    const special = findWallSpecialPointSnap(point, walls, ignoreWallIds, snapRadii)
    if (special) return special
  }

  const step = overrideStep ?? getSegmentGridStep()
  // The angle path snaps the distance ALONG the 15° ray from `start`, so the
  // `gridSnap` override only applies when the angle lock is off.
  const basePoint: WallPlanPoint =
    start && angleSnap
      ? [...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, step)]
      : gridSnap
        ? gridSnap(point)
        : snapPointToGrid(point, step)

  if (magnetic) {
    const wallSnap = findWallSnapTarget(basePoint, walls, {
      ignoreWallIds,
      radius: snapRadii?.wall,
    })
    if (wallSnap) {
      return {
        point: wallSnap,
        snap: 'wall',
        targetWallIds: wallIdsAtSnapPoint(wallSnap, walls, ignoreWallIds),
      }
    }
    return { point: basePoint, snap: null, targetWallIds: [] }
  }

  // Non-magnetic modes (grid / off / angles): connectivity still sticks so a
  // room can close, but only within a tight radius — placement elsewhere is left
  // to the mode (grid quantise / angle lock / free). Snap from the already
  // positioned `basePoint` so the mode's placement is respected right up to the
  // wall, then the last few cm stick onto it (and the beacon shows).
  const connectRadii: WallSnapRadii = {
    endpoint: WALL_CONNECT_SNAP_RADIUS,
    midpoint: WALL_CONNECT_SNAP_RADIUS,
    intersection: WALL_CONNECT_SNAP_RADIUS,
    wall: WALL_CONNECT_SNAP_RADIUS,
  }
  const connectSpecial = findWallSpecialPointSnap(basePoint, walls, ignoreWallIds, connectRadii)
  if (connectSpecial) return connectSpecial
  // A wall end aimed into a wall's body joins it, whichever lattice point or
  // ray station the mode picked near its face.
  const bodySnap = captureWallBodies
    ? findWallBodySnapTarget(point, bodyWalls, {
        ignoreWallIds,
        placed: basePoint,
        start,
        margin: WALL_CONNECT_SNAP_RADIUS,
      })
    : null
  if (bodySnap) {
    // An end aimed into a corner block joins the corner, and reads as one.
    const atCorner = bodyWalls.some(
      (wall) =>
        !ignoreWallIds?.includes(wall.id) &&
        (distanceSquared(bodySnap, wall.start) <= 1e-12 ||
          distanceSquared(bodySnap, wall.end) <= 1e-12),
    )
    return {
      point: bodySnap,
      snap: atCorner ? 'endpoint' : 'wall',
      targetWallIds: wallIdsAtSnapPoint(bodySnap, walls, ignoreWallIds),
    }
  }
  const connectWall = findWallSnapTarget(basePoint, walls, {
    ignoreWallIds,
    radius: WALL_CONNECT_SNAP_RADIUS,
  })
  if (connectWall) {
    return {
      point: connectWall,
      snap: 'wall',
      targetWallIds: wallIdsAtSnapPoint(connectWall, walls, ignoreWallIds),
    }
  }

  return { point: basePoint, snap: null, targetWallIds: [] }
}

export function snapWallDraftPoint(args: SnapWallDraftArgs): WallPlanPoint {
  return snapWallDraftPointDetailed(args).point
}

export function isSegmentLongEnough(start: WallPlanPoint, end: WallPlanPoint): boolean {
  return distanceSquared(start, end) >= WALL_MIN_LENGTH * WALL_MIN_LENGTH
}

/**
 * An invisible wall drawn `start` → `end` on the current level (the Invisible wall tile, a room
 * divider): room separators, each end joined to a wall it lands on and broken
 * either side of a wall it crosses (`planSeparatorInsertion`), as one undo step. Rooms close on
 * it; a room it closes off outside the house becomes a porch. The last piece, for the run to go
 * on from its end; null when it would be too short.
 */
export function createInvisibleWallOnCurrentLevel(
  start: WallPlanPoint,
  end: WallPlanPoint,
): SeparatorNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes, applyNodeChanges } = useScene.getState()
  if (!(currentLevelId && isSegmentLongEnough(start, end))) return null
  const joinRadius = isMagneticSnapActive() ? WALL_JOIN_SNAP_RADIUS : WALL_CONNECT_SNAP_RADIUS
  return runAsSingleSceneHistoryStep(useScene, () => {
    const plan = planSeparatorInsertion(nodes, {
      levelId: currentLevelId as AnyNodeId,
      start,
      end,
      joinRadius,
      mintId: () => generateId('separator'),
    })
    if (!plan) return null
    applyNodeChanges(plan.changes)
    sfxEmitter.emit('sfx:structure-build')
    return plan.separators.at(-1) ?? null
  })
}

export function createWallOnCurrentLevel(
  start: WallPlanPoint,
  end: WallPlanPoint,
  options?: WallConstructionOptions,
): WallNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes, applyNodeChanges } = useScene.getState()

  if (!(currentLevelId && isSegmentLongEnough(start, end))) {
    return null
  }

  const joinRadius = isMagneticSnapActive() ? WALL_JOIN_SNAP_RADIUS : WALL_CONNECT_SNAP_RADIUS

  return runAsSingleSceneHistoryStep(useScene, () => {
    // The Railing tile draws railings: a guard of their own, not the Build panel's wall types.
    const railing = getWallLineKind() === 'railing'
    const insertion = {
      levelId: currentLevelId as AnyNodeId,
      start,
      end,
      joinRadius,
      wallDefaults: railing
        ? railingWallDefaults()
        : (useEditor.getState().toolDefaults.wall ?? {}),
      wallTypes: railing ? undefined : getDrawnWallTypes(),
      // A wall drawn into another meets its inside face and leaves it whole,
      // as a framed partition does; the split tool breaks a wall on purpose.
      keepHostsWhole: true,
    }
    let result = planWallInsertion(nodes, insertion)
    if (!result.ok && result.reason === 'covered-existing-wall') {
      // Drawn over walls built another way (an outside wall over an inside
      // jog), the new wall takes their stretch over; over walls built the
      // same, it would change nothing, so it stays refused.
      const replacing = planWallInsertion(nodes, { ...insertion, replaceCovered: true })
      if (
        replacing.ok &&
        replacing.plan.insertedWalls.some((wall) =>
          wallsRunAlong(nodes, { ...wall, parentId: currentLevelId } as WallNode).some(
            (covered) => !sameWallConstruction(covered, wall),
          ),
        )
      )
        result = replacing
    }
    if (!result.ok) return null
    const { plan } = result

    const construction = resolveWallConstruction(nodes, currentLevelId, plan.insertedWalls, options)
    const finalizedWalls = construction.walls
    const finalizedWallsById = new Map(finalizedWalls.map((wall) => [wall.id, wall]))
    const sourceUpdate = construction.sourceSupportUpdate
    const sourceAlreadyUpdated = sourceUpdate
      ? plan.changes.update.some((operation) => operation.id === sourceUpdate.id)
      : false
    // A wall drawn along part of a parallel wall takes that stretch over, so
    // drawing on from a wall never doubles the one it runs along.
    applyNodeChanges(
      finishWallEdit(
        nodes,
        {
          ...plan.changes,
          update: plan.changes.update
            .map((operation) =>
              sourceUpdate?.id === operation.id
                ? { ...operation, data: { ...operation.data, ...sourceUpdate.data } }
                : operation,
            )
            .concat(sourceUpdate && !sourceAlreadyUpdated ? [sourceUpdate] : []),
          create: plan.changes.create.map((operation) => ({
            ...operation,
            node: finalizedWallsById.get(operation.node.id as WallNode['id']) ?? operation.node,
          })),
        },
        { winnerIds: finalizedWalls.map((wall) => wall.id), mintId: () => generateId('wall') },
      ),
    )
    sfxEmitter.emit('sfx:structure-build')

    const terminalWall = finalizedWalls.at(-1)!
    const committedWall = useScene.getState().nodes[plan.terminalWallId]
    return committedWall?.type === 'wall' ? committedWall : terminalWall
  })
}
