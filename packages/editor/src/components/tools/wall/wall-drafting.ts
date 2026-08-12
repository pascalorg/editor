import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  DEFAULT_LEVEL_HEIGHT,
  GROUND_SUPPORT_ID,
  planWallInsertion,
  planWallSplitAtPoint,
  resolveSupportSlabPatch,
  resolveWallSupportSlabPatch,
  runAsSingleSceneHistoryStep,
  snapPointAlongAngleRay,
  spatialGridManager,
  terrainSupportLift,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
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

export type WallConstructionOptions = {
  /** Pointer-decided maximum support elevation in level-local metres. */
  supportCap?: number | null
  /** Support source selected by the first click or inherited from a snapped wall. */
  preferredSupportSlabId?: string | null
  /** Frozen level-local Y shown by the draft ghost. */
  constructionElevation?: number | null
  /** Height shown by the draft ghost. */
  constructionHeight?: number | null
  /** Keep a node-top construction plane flat instead of filling down to lower slab segments. */
  flatConstructionBase?: boolean
  /** Node whose top surface established this construction plane. */
  constructionSourceNodeId?: AnyNodeId | null
}

export function resolveTerrainWallConstructionOptions(
  nodes: Record<string, AnyNode>,
  levelId: string,
  point: WallPlanPoint,
  defaults?: Record<string, unknown>,
): WallConstructionOptions | undefined {
  const constructionElevation = terrainSupportLift(nodes, levelId, point[0], point[1])
  if (constructionElevation == null) return undefined

  const level = nodes[levelId]
  const constructionHeight =
    typeof defaults?.height === 'number'
      ? defaults.height
      : level?.type === 'level'
        ? (level.height ?? DEFAULT_LEVEL_HEIGHT)
        : DEFAULT_LEVEL_HEIGHT

  return {
    constructionElevation,
    constructionHeight,
    supportCap: constructionElevation,
  }
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

    const constructionSourceNodeId = options?.constructionSourceNodeId
    if (constructionSourceNodeId) {
      const sourceNodes = useScene.getState().nodes
      const sourceNode = sourceNodes[constructionSourceNodeId]
      const currentSupport =
        sourceNode && 'supportSlabId' in sourceNode
          ? (sourceNode.supportSlabId as string | undefined)
          : undefined
      if (sourceNode && currentSupport == null) {
        const sourceSupportPatch = resolveSupportSlabPatch(sourceNode, sourceNodes, {
          pinSupport: true,
        })
        if (sourceSupportPatch.supportSlabId != null) {
          useScene
            .getState()
            .updateNodes([{ id: constructionSourceNodeId, data: sourceSupportPatch }])
        }
      }
    }

    const committedNodes = useScene.getState().nodes
    const finalizedWalls = plan.insertedWalls.map((createdWall) => {
      const wallWithParent = { ...createdWall, parentId: currentLevelId } as WallNode
      const terrainBase = terrainSupportLift(
        committedNodes,
        currentLevelId,
        createdWall.start[0],
        createdWall.start[1],
      )
      // A ground-preferred draft is frozen only for sculpted terrain or an
      // explicitly flat node-top construction plane. On ordinary flat ground,
      // the ground plane is just the backdrop the chain started from: drop the
      // draft options so the wall commits plane-bound.
      const wallOptions =
        options?.preferredSupportSlabId === GROUND_SUPPORT_ID &&
        terrainBase == null &&
        !options.flatConstructionBase
          ? undefined
          : options
      const preferredSupportSlabId =
        wallOptions?.flatConstructionBase === true
          ? GROUND_SUPPORT_ID
          : (wallOptions?.preferredSupportSlabId ??
            (wallOptions?.constructionElevation != null && terrainBase != null
              ? GROUND_SUPPORT_ID
              : null))
      const supportPatch = resolveWallSupportSlabPatch(wallWithParent, committedNodes, {
        maxElevation: wallOptions?.supportCap ?? null,
        preferredSlabId: preferredSupportSlabId,
      })
      const supportSlabId = supportPatch.supportSlabId
      const sourceSupport = spatialGridManager.getSlabSupportForWall(
        currentLevelId,
        createdWall.start,
        createdWall.end,
        createdWall.curveOffset,
        createdWall.thickness,
        supportSlabId,
        wallOptions?.supportCap ?? null,
      )
      // Freezing the draft plane into the node (explicit height + offset from
      // the elected support) is reserved for terrain and explicitly flat
      // node-top construction. Every other wall stays plane-bound, so a wall
      // merely started on a slab or deck never receives the ghost height.
      const groundDraft =
        preferredSupportSlabId === GROUND_SUPPORT_ID &&
        (terrainBase != null || wallOptions?.flatConstructionBase === true)
      const supportOffset =
        groundDraft && wallOptions?.constructionElevation != null
          ? wallOptions.constructionElevation - sourceSupport.elevation
          : undefined
      const preserveDraftHeight =
        groundDraft &&
        createdWall.height == null &&
        wallOptions?.constructionHeight != null &&
        wallOptions.constructionElevation != null
      return {
        ...wallWithParent,
        ...supportPatch,
        height: preserveDraftHeight
          ? (wallOptions?.constructionHeight ?? createdWall.height)
          : createdWall.height,
        supportOffset:
          supportOffset != null && Math.abs(supportOffset) > 1e-6 ? supportOffset : undefined,
      } as WallNode
    })
    const finalizedWallsById = new Map(finalizedWalls.map((wall) => [wall.id, wall]))
    applyNodeChanges({
      ...plan.changes,
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
