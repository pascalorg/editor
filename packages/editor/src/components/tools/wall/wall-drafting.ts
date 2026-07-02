import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_ANGLE_STEP,
  type DoorNode,
  getScaledDimensions,
  type ItemNode,
  snapPointAlongAngleRay,
  useScene,
  type WallNode,
  WallNode as WallSchema,
  type WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import useEditor, { getActiveSnappingMode, isMagneticSnapActive } from '../../../store/use-editor'
import {
  distanceSquared,
  findWallSnapTarget,
  findWallSpecialPointSnap,
  projectPointOntoWall,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallDraftSnapResult,
  type WallPlanPoint,
  type WallSnapRadii,
} from './wall-snap-geometry'

// The pure snap geometry lives in `./wall-snap-geometry`; re-exported here so
// existing importers (fence drafting, the editor barrel) keep their paths.
export {
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
// An endpoint projecting within this distance of an existing wall's corner
// resolves to the corner without splitting — splitting there would mint a
// sliver segment a hair longer than `WALL_MIN_LENGTH` that no snap radius
// can ever target again.
const WALL_SPLIT_ENDPOINT_EPSILON = 0.02

type WallSplitIntersection = {
  /** `null` = snap-only outcome: resolve to `point` but split no wall. */
  wallId: WallNode['id'] | null
  point: WallPlanPoint
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

function splitWallAtPoint(wall: WallNode, splitPoint: WallPlanPoint): [WallNode, WallNode] {
  const { id: _id, parentId: _parentId, children, ...rest } = wall

  const first = WallSchema.parse({
    ...rest,
    start: wall.start,
    end: splitPoint,
    children: [],
  })
  const second = WallSchema.parse({
    ...rest,
    start: splitPoint,
    end: wall.end,
    children: [],
  })

  return [first, second]
}

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint, tolerance = 1e-6): boolean {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function findWallIntersection(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
): WallSplitIntersection | null {
  const ignore = new Set(ignoreWallIds ?? [])
  let best: WallSplitIntersection | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignore.has(wall.id)) continue

    const projected = projectPointOntoWall(point, wall)
    if (!projected) continue

    const candidateDistanceSquared = distanceSquared(point, projected)
    if (
      candidateDistanceSquared > WALL_JOIN_SNAP_RADIUS * WALL_JOIN_SNAP_RADIUS ||
      candidateDistanceSquared >= bestDistanceSquared
    ) {
      continue
    }

    const nearCorner = ([wall.start, wall.end] as WallPlanPoint[]).find(
      (corner) =>
        distanceSquared(projected, corner) <=
        WALL_SPLIT_ENDPOINT_EPSILON * WALL_SPLIT_ENDPOINT_EPSILON,
    )
    best = nearCorner
      ? { wallId: null, point: [nearCorner[0], nearCorner[1]] }
      : { wallId: wall.id, point: projected }
    bestDistanceSquared = candidateDistanceSquared
  }

  return best
}

function wallHasAttachments(wall: WallNode, nodes: ReturnType<typeof useScene.getState>['nodes']) {
  if ((wall.children?.length ?? 0) > 0) {
    return true
  }

  return Object.values(nodes).some((node) => {
    if (!node) return false
    if ('parentId' in node && node.parentId === wall.id) return true
    if ('wallId' in node && typeof node.wallId === 'string' && node.wallId === wall.id) return true
    return false
  })
}

function wallLength(wall: Pick<WallNode, 'start' | 'end'>) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function getWallAttachmentSpan(node: AnyNode): { min: number; max: number; center: number } | null {
  if (node.type === 'door') {
    const door = node as DoorNode
    return {
      min: door.position[0] - door.width / 2,
      max: door.position[0] + door.width / 2,
      center: door.position[0],
    }
  }

  if (node.type === 'window') {
    const win = node as WindowNode
    return {
      min: win.position[0] - win.width / 2,
      max: win.position[0] + win.width / 2,
      center: win.position[0],
    }
  }

  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') {
      return null
    }

    const [width] = getScaledDimensions(item)
    return {
      min: item.position[0] - width / 2,
      max: item.position[0] + width / 2,
      center: item.position[0],
    }
  }

  return null
}

function remapAttachmentToWall(
  node: AnyNode,
  nextWallId: WallNode['id'],
  nextLocalX: number,
  nextWallLength: number,
): Partial<AnyNode> | null {
  const clampedX = Math.max(0, Math.min(nextWallLength, nextLocalX))

  if (node.type === 'door' || node.type === 'window' || node.type === 'item') {
    const currentPosition = 'position' in node ? node.position : null
    if (!currentPosition) return null

    const nextPosition: typeof currentPosition = [
      clampedX,
      currentPosition[1],
      currentPosition[2],
    ] as typeof currentPosition

    return {
      parentId: nextWallId,
      position: nextPosition,
      ...(node.type === 'item'
        ? {
            wallId: nextWallId,
            wallT: nextWallLength > 1e-6 ? clampedX / nextWallLength : 0,
          }
        : {
            wallId: nextWallId,
          }),
    } as Partial<AnyNode>
  }

  return null
}

function buildAttachmentMigrationPlan(
  wall: WallNode,
  splitPoint: WallPlanPoint,
  firstWall: WallNode,
  secondWall: WallNode,
  nodes: ReturnType<typeof useScene.getState>['nodes'],
): { id: AnyNodeId; data: Partial<AnyNode> }[] | null {
  const splitDistance = Math.hypot(splitPoint[0] - wall.start[0], splitPoint[1] - wall.start[1])
  const firstLength = wallLength(firstWall)
  const secondLength = wallLength(secondWall)
  const tolerance = 1e-4
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []

  for (const childId of wall.children ?? []) {
    const childNode = nodes[childId as AnyNodeId]
    if (!childNode) continue

    const span = getWallAttachmentSpan(childNode)
    if (!span) {
      return null
    }

    if (span.max <= splitDistance + tolerance) {
      const nextUpdate = remapAttachmentToWall(childNode, firstWall.id, span.center, firstLength)
      if (!nextUpdate) return null
      updates.push({ id: childNode.id as AnyNodeId, data: nextUpdate })
      continue
    }

    if (span.min >= splitDistance - tolerance) {
      const nextUpdate = remapAttachmentToWall(
        childNode,
        secondWall.id,
        span.center - splitDistance,
        secondLength,
      )
      if (!nextUpdate) return null
      updates.push({ id: childNode.id as AnyNodeId, data: nextUpdate })
      continue
    }

    return null
  }

  return updates
}

function splitWallIfNeeded(
  intersection: WallSplitIntersection | null,
  walls: WallNode[],
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  createNodes: ReturnType<typeof useScene.getState>['createNodes'],
  updateNodes: ReturnType<typeof useScene.getState>['updateNodes'],
  deleteNode: ReturnType<typeof useScene.getState>['deleteNode'],
): { walls: WallNode[]; point: WallPlanPoint } | null {
  if (!intersection) return null

  if (!intersection.wallId) {
    return { walls, point: intersection.point }
  }

  const wallToSplit = walls.find((wall) => wall.id === intersection.wallId)
  if (!wallToSplit) {
    return { walls, point: intersection.point }
  }

  const [first, second] = splitWallAtPoint(wallToSplit, intersection.point)
  const attachmentUpdates = buildAttachmentMigrationPlan(
    wallToSplit,
    intersection.point,
    first,
    second,
    nodes,
  )

  if (wallHasAttachments(wallToSplit, nodes) && !attachmentUpdates) {
    return { walls, point: intersection.point }
  }

  createNodes([
    { node: first, parentId: wallToSplit.parentId as AnyNodeId | undefined },
    { node: second, parentId: wallToSplit.parentId as AnyNodeId | undefined },
  ])
  if (attachmentUpdates && attachmentUpdates.length > 0) {
    updateNodes(attachmentUpdates)
  }
  deleteNode(wallToSplit.id as AnyNodeId)

  return {
    walls: [...walls.filter((wall) => wall.id !== wallToSplit.id), first, second],
    point: intersection.point,
  }
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

  if (bypassSnap) return { point, snap: null }

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
    if (wallSnap) return { point: wallSnap, snap: 'wall' }
    return { point: basePoint, snap: null }
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
  if (connectWall) return { point: connectWall, snap: 'wall' }

  return { point: basePoint, snap: null }
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
): WallNode | null {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, createNodes, deleteNode, nodes } = useScene.getState()
  const { updateNodes } = useScene.getState()

  if (!(currentLevelId && isSegmentLongEnough(start, end))) {
    return null
  }

  let workingWalls = Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === currentLevelId,
  )

  let resolvedStart = start
  let resolvedEnd = end

  // The corner-join / wall-split snap on commit is a magnetic (line) snap, so
  // it must be gated by the snapping mode like the draft preview is. Without
  // this gate `'off'` (and `'angles'`) still snapped the committed endpoint to
  // existing wall geometry — the residual snap the draft path no longer does.
  if (isMagneticSnapActive()) {
    const endIntersection = findWallIntersection(resolvedEnd, workingWalls)
    const splitEnd = splitWallIfNeeded(
      endIntersection,
      workingWalls,
      nodes,
      createNodes,
      updateNodes,
      deleteNode,
    )
    if (splitEnd) {
      workingWalls = splitEnd.walls
      resolvedEnd = splitEnd.point
    }

    const startIntersection = findWallIntersection(resolvedStart, workingWalls)
    const splitStart = splitWallIfNeeded(
      startIntersection,
      workingWalls,
      nodes,
      createNodes,
      updateNodes,
      deleteNode,
    )
    if (splitStart) {
      workingWalls = splitStart.walls
      resolvedStart = splitStart.point
    }
  }

  if (!isSegmentLongEnough(resolvedStart, resolvedEnd) || pointsEqual(resolvedStart, resolvedEnd)) {
    return null
  }

  const duplicateWall = workingWalls.some(
    (wall) =>
      (pointsEqual(wall.start, resolvedStart) && pointsEqual(wall.end, resolvedEnd)) ||
      (pointsEqual(wall.start, resolvedEnd) && pointsEqual(wall.end, resolvedStart)),
  )
  if (duplicateWall) {
    return null
  }

  const wallCount = Object.values(nodes).filter((node) => node.type === 'wall').length
  // A placed wall preset seeds `toolDefaults.wall` (thickness, height,
  // materials, sides) before the tool activates; merge those first so the
  // drawn wall reproduces the preset. Identity + endpoints always win.
  const defaults = useEditor.getState().toolDefaults.wall ?? {}
  const wall = WallSchema.parse({
    ...defaults,
    name: `Wall ${wallCount + 1}`,
    start: resolvedStart,
    end: resolvedEnd,
  })

  createNode(wall, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')

  return wall
}
