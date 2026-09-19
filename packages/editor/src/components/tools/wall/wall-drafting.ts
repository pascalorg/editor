import {
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  planWallInsertion,
  planWallSplitAtPoint,
  resolveWallConstruction,
  runAsSingleSceneHistoryStep,
  snapPointAlongAngleRay,
  useScene,
  type WallConstructionOptions,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { parseMeasurement } from '../../../lib/measurement-parser'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import useEditor, { getActiveSnappingMode, isMagneticSnapActive } from '../../../store/use-editor'
import {
  distanceSquared,
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

/**
 * Keep an exact-length wall draft on the pointer's current heading. Snapping
 * still determines the heading, while the explicit input owns the distance.
 */
export function constrainWallDraftLength(
  start: WallPlanPoint,
  end: WallPlanPoint,
  lengthMeters: number | null,
): WallPlanPoint {
  if (!(lengthMeters != null && Number.isFinite(lengthMeters) && lengthMeters > 0)) {
    return end
  }

  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const headingLength = Math.hypot(dx, dz)
  if (headingLength < 1e-6) return end

  return [
    start[0] + (dx / headingLength) * lengthMeters,
    start[1] + (dz / headingLength) * lengthMeters,
  ]
}

/**
 * Parse a wall draft's free-text length into the editor's canonical metres.
 * Bare values follow the unit toggle (and metric mm notation); explicit
 * suffixes always win.
 */
export function parseWallDraftLength(
  raw: string,
  unit: 'metric' | 'imperial',
  metricNotation: 'meters' | 'millimeters' = 'meters',
): number | null {
  const bareUnit = unit === 'imperial' ? 'ft' : metricNotation === 'millimeters' ? 'mm' : 'm'
  const parsed = parseMeasurement(
    raw,
    { kind: 'length', unitId: 'm' },
    { bareUnit, system: unit === 'imperial' ? 'us' : 'metric' },
  )

  return parsed != null && parsed >= WALL_MIN_LENGTH ? parsed : null
}

/**
 * Re-project a live draft end onto the typed length along the current heading.
 * Used when the buffer / unit changes without a pointer move — never re-snaps.
 * Empty or unparsable input leaves `currentEnd` unchanged.
 */
export function refreshWallDraftTypedEnd(args: {
  start: WallPlanPoint | null
  currentEnd: WallPlanPoint | null
  raw: string
  unit: 'metric' | 'imperial'
  metricNotation?: 'meters' | 'millimeters'
}): WallPlanPoint | null {
  if (!args.start || !args.currentEnd) return args.currentEnd ?? null
  return constrainWallDraftLength(
    args.start,
    args.currentEnd,
    parseWallDraftLength(args.raw, args.unit, args.metricNotation),
  )
}

/**
 * Resolve the wall-draft commit endpoint.
 *
 * Enter already projected `clickPoint` along the pointer heading. Re-snapping
 * that projected point can steal heading near other walls, then length is
 * reapplied along the wrong ray. Skip snap and only re-apply the typed metres
 * (idempotent). Pointer clicks still snap, then constrain if a live buffer
 * is present.
 */
export function resolveWallDraftCommitEnd(args: {
  start: WallPlanPoint
  clickPoint: WallPlanPoint
  typedCommitMeters: number | null
  snapEnd: (point: WallPlanPoint) => WallPlanPoint
  liveTypedMeters: number | null
}): WallPlanPoint {
  if (args.typedCommitMeters != null) {
    return constrainWallDraftLength(args.start, args.clickPoint, args.typedCommitMeters)
  }
  return constrainWallDraftLength(args.start, args.snapEnd(args.clickPoint), args.liveTypedMeters)
}

/**
 * Split-view 2D rubber band: copy the draft store's chain start into local
 * `draftStart`. A null store start means the 3D owner ended the chain, so the
 * local start must clear too — otherwise the 2D band stays open.
 */
export function nextLocalWallDraftStartFromStore(
  storeWallDraftStart: WallPlanPoint | null,
  localDraftStart: WallPlanPoint | null,
): WallPlanPoint | null {
  if (!storeWallDraftStart) return null
  if (
    localDraftStart &&
    localDraftStart[0] === storeWallDraftStart[0] &&
    localDraftStart[1] === storeWallDraftStart[1]
  ) {
    return localDraftStart
  }
  return storeWallDraftStart
}

/**
 * 3D ended the chain (published start went non-null → null). A null that was
 * always null (2D first click before the mirror effect, WallTool unmount) must
 * not wipe local draftStart / wallChainWallIdsRef.
 */
export function shouldResetWallPlacementDraftFromStoreStart(
  wallBuildActive: boolean,
  storeWallDraftStart: WallPlanPoint | null,
  previousStoreWallDraftStart: WallPlanPoint | null,
): boolean {
  return (
    wallBuildActive &&
    storeWallDraftStart == null &&
    previousStoreWallDraftStart != null
  )
}

/**
 * 2D may start a wall while the 3D canvas is hidden, so WallTool's
 * buildingState stays 0. A typed Enter that emits grid:click must still
 * commit from that published start rather than treating the click as a
 * new first point.
 */
export function adoptedWallDraftStartForTypedCommit(args: {
  buildingState: number
  typedCommitMeters: number | null
  publishedStart: WallPlanPoint | null
}): WallPlanPoint | null {
  if (args.buildingState !== 0 || args.typedCommitMeters == null) return null
  return args.publishedStart
}

/**
 * True when WallTool already committed on this grid:click (published a next
 * chain start, or stopDrafting nulled the store while 2D still had a draft).
 */
export function wallToolCommittedOnFloorplanClick(args: {
  publishedNextStart: WallPlanPoint | null
  storeWallDraftStart: WallPlanPoint | null
  hadLocalDraftStart: boolean
}): boolean {
  if (args.publishedNextStart != null) return true
  return args.hadLocalDraftStart && args.storeWallDraftStart == null
}

/**
 * 2D-only creates locally only when WallTool did not already commit on the
 * same grid:click. WallTool stays mounted in 2D-only (hidden canvas) and
 * receives the emit synchronously — a twin local create can land a second
 * unconstrained wall after WallTool clearInput'd the typed buffer.
 */
export function shouldCreateWallLocallyOnFloorplanPlacement(args: {
  viewIs2DOnly: boolean
  wallToolOwnedTypedCommit: boolean
  wallToolAlreadyCommitted?: boolean
}): boolean {
  if (args.wallToolAlreadyCommitted) return false
  return args.viewIs2DOnly && !args.wallToolOwnedTypedCommit
}

/**
 * When WallTool already committed (and may have stopDrafting'd), clear the 2D
 * rubber band if no next chain start was published — including 2D-only typed
 * Enter and 2D-only pointer clicks WallTool handled. Require storeWallDraftStart
 * == null for the 2D-only path so a no-op / failed WallTool click does not
 * discard an open rubber band. Pointer 2D-only create path keeps chaining via
 * createdWall instead.
 */
export function shouldClearFloorplanDraftAfterWallToolCommit(args: {
  viewIs2DOnly: boolean
  wallToolOwnedTypedCommit: boolean
  publishedNextStart: WallPlanPoint | null
  storeWallDraftStart?: WallPlanPoint | null
  wallToolAlreadyCommitted?: boolean
}): boolean {
  if (args.publishedNextStart) return false
  if (!args.viewIs2DOnly) return true
  const wallToolFinished =
    args.wallToolOwnedTypedCommit || args.wallToolAlreadyCommitted === true
  if (!wallToolFinished) return false
  return args.storeWallDraftStart === undefined || args.storeWallDraftStart == null
}

/** True when emit consumed pendingCommitMeters (WallTool onGridClick ran past take). */
export function wallToolOwnedTypedCommitFromPending(
  pendingCommitMetersAfterEmit: number | null,
): boolean {
  return pendingCommitMetersAfterEmit == null
}

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
   * Optional grid-snap override. Lets the caller route grid snapping
   * through a world-XZ aligned snap (so a rotated building's draft
   * lands on the visible grid). When omitted, falls back to the
   * local-axis grid at `step`.
   */
  gridSnap?: (point: WallPlanPoint) => WallPlanPoint
  /** Optional magnetic snap radii. Omitted means wall tools keep their defaults. */
  snapRadii?: WallSnapRadii
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
  // The angle path snaps the distance ALONG the 15° ray — a scalar, the
  // same in world and local frames — so the `gridSnap` world-grid override
  // only applies when the angle lock is off.
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
    const result = planWallInsertion(nodes, {
      levelId: currentLevelId as AnyNodeId,
      start,
      end,
      joinRadius,
      wallDefaults: useEditor.getState().toolDefaults.wall ?? {},
    })
    if (!result.ok) return null
    const { plan } = result

    const construction = resolveWallConstruction(nodes, currentLevelId, plan.insertedWalls, options)
    const finalizedWalls = construction.walls
    const finalizedWallsById = new Map(finalizedWalls.map((wall) => [wall.id, wall]))
    const sourceUpdate = construction.sourceSupportUpdate
    const sourceAlreadyUpdated = sourceUpdate
      ? plan.changes.update.some((operation) => operation.id === sourceUpdate.id)
      : false
    applyNodeChanges({
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
    })
    sfxEmitter.emit('sfx:structure-build')

    const terminalWall = finalizedWalls.at(-1)!
    const committedWall = useScene.getState().nodes[plan.terminalWallId]
    return committedWall?.type === 'wall' ? committedWall : terminalWall
  })
}
