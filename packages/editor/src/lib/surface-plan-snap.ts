import {
  type AlignmentAnchor,
  type AlignmentGuide,
  type AnyNode,
  collectAlignmentAnchors,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  resolveLevelId,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  snapWallDraftPointDetailed,
  WALL_CONNECT_SNAP_RADIUS,
  type WallDraftSnapKind,
  type WallPlanPoint,
  type WallSnapRadii,
} from '../components/tools/wall/wall-drafting'
import useAlignmentGuides from '../store/use-alignment-guides'
import { isMagneticSnapActive } from '../store/use-editor'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'
import { resolveAlignmentForFloorplanView } from './world-grid-snap'

const SURFACE_SNAP_MOVING_ID = '__surface_snap__'
export const SURFACE_ALIGNMENT_THRESHOLD_M = 0.08
const SURFACE_WALL_SNAP_RADII = {
  endpoint: 0.38,
  midpoint: 0.28,
  intersection: 0.28,
  wall: 0.18,
} satisfies WallSnapRadii
const WALL_SOURCE_MATCH_EPSILON = 0.035

export type SurfacePlanSnapInput = {
  rawPoint: WallPlanPoint
  fallbackPoint?: WallPlanPoint
  levelId?: string | null
  excludeId?: string | null
  movingId?: string
  nodes?: Readonly<Record<string, AnyNode>>
  walls?: readonly WallNode[]
  candidates?: readonly AlignmentAnchor[]
  threshold?: number
  altKey?: boolean
  shiftKey?: boolean
  magnetic?: boolean
  align?: boolean
  highlightWalls?: boolean
  step?: number
  snapRadii?: WallSnapRadii
}

export type SurfacePlanSnapResult = {
  point: WallPlanPoint
  wallSnap: WallDraftSnapKind | null
  guides: AlignmentGuide[]
  wallIds: string[]
}

function getLevelWalls(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string | null | undefined,
  walls?: readonly WallNode[],
): WallNode[] {
  const source =
    walls ?? Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
  if (!levelId) return source.filter((wall) => wall.visible !== false)

  return source.filter(
    (wall) =>
      wall.visible !== false && resolveLevelId(wall, nodes as Record<string, AnyNode>) === levelId,
  )
}

function distanceSquared(a: WallPlanPoint, b: WallPlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function wallMidpoint(wall: WallNode): WallPlanPoint {
  if (isCurvedWall(wall)) {
    const frame = getWallCurveFrameAt(wall, 0.5)
    return [frame.point.x, frame.point.y]
  }
  return [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
}

function distanceToSegmentSquared(point: WallPlanPoint, start: WallPlanPoint, end: WallPlanPoint) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return distanceSquared(point, start)

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )
  const projected: WallPlanPoint = [start[0] + dx * t, start[1] + dz * t]
  return distanceSquared(point, projected)
}

function distanceToWallSquared(point: WallPlanPoint, wall: WallNode) {
  if (!isCurvedWall(wall)) {
    return distanceToSegmentSquared(point, wall.start, wall.end)
  }

  const sampleCount = Math.max(8, Math.ceil(getWallCurveLength(wall) / 0.3))
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  let previous = getWallCurveFrameAt(wall, 0).point
  for (let index = 1; index <= sampleCount; index += 1) {
    const current = getWallCurveFrameAt(wall, index / sampleCount).point
    const distance = distanceToSegmentSquared(
      point,
      [previous.x, previous.y],
      [current.x, current.y],
    )
    bestDistanceSquared = Math.min(bestDistanceSquared, distance)
    previous = current
  }
  return bestDistanceSquared
}

function closestWallIds(point: WallPlanPoint, walls: readonly WallNode[], count: number) {
  return walls
    .map((wall) => ({ id: wall.id, distance: distanceToWallSquared(point, wall) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map(({ id }) => id)
}

function findSnapSourceWallIds(
  point: WallPlanPoint,
  kind: WallDraftSnapKind,
  walls: readonly WallNode[],
): string[] {
  const epsilonSquared = WALL_SOURCE_MATCH_EPSILON ** 2

  if (kind === 'endpoint') {
    const endpointMatches = walls.filter(
      (wall) =>
        distanceSquared(point, wall.start) <= epsilonSquared ||
        distanceSquared(point, wall.end) <= epsilonSquared,
    )
    if (endpointMatches.length > 0) return endpointMatches.map((wall) => wall.id)
    return closestWallIds(point, walls, 1)
  }

  if (kind === 'midpoint') {
    const midpointMatches = walls.filter(
      (wall) => distanceSquared(point, wallMidpoint(wall)) <= epsilonSquared,
    )
    if (midpointMatches.length > 0) return midpointMatches.map((wall) => wall.id)
    return closestWallIds(point, walls, 1)
  }

  if (kind === 'intersection') {
    const crossingMatches = walls.filter(
      (wall) => distanceToWallSquared(point, wall) <= epsilonSquared,
    )
    if (crossingMatches.length > 0) return crossingMatches.map((wall) => wall.id).slice(0, 2)
    return closestWallIds(point, walls, 2)
  }

  return closestWallIds(point, walls, 1)
}

export function clearSurfacePlanSnapFeedback() {
  useAlignmentGuides.getState().clear()
  useWallSnapIndicator.getState().clear()
}

export function resolveSurfacePlanPointSnap(input: SurfacePlanSnapInput): SurfacePlanSnapResult {
  const nodes = input.nodes ?? useScene.getState().nodes
  const walls = getLevelWalls(nodes, input.levelId, input.walls)
  const fallbackPoint = input.fallbackPoint
  const magnetic = input.magnetic ?? isMagneticSnapActive()

  const wallSnap = snapWallDraftPointDetailed({
    point: input.rawPoint,
    walls,
    step: input.step ?? getSegmentGridStep(),
    magnetic,
    snapRadii: input.snapRadii ?? SURFACE_WALL_SNAP_RADII,
    gridSnap: fallbackPoint ? () => fallbackPoint : undefined,
  })

  if (wallSnap.snap) {
    const wallIds =
      input.highlightWalls === false
        ? []
        : findSnapSourceWallIds(wallSnap.point, wallSnap.snap, walls)
    useWallSnapIndicator.getState().set({
      x: wallSnap.point[0],
      z: wallSnap.point[1],
      kind: wallSnap.snap,
      ...(wallIds.length > 0 ? { wallIds } : {}),
    })
    useAlignmentGuides.getState().clear()
    return { point: wallSnap.point, wallSnap: wallSnap.snap, guides: [], wallIds }
  }

  useWallSnapIndicator.getState().clear()

  // Alignment "lines" are DISPLAYED in every mode (grid / lines / angles /
  // off); the magnetic pull onto an axis is applied only when magnetic
  // ('lines'). Shift / Alt / `align: false` fully bypass (no guides).
  const basePoint = fallbackPoint ?? wallSnap.point
  if (input.align === false || input.altKey) {
    useAlignmentGuides.getState().clear()
    return { point: basePoint, wallSnap: null, guides: [], wallIds: [] }
  }

  const movingId = input.movingId ?? SURFACE_SNAP_MOVING_ID
  const allCandidates =
    input.candidates ??
    collectAlignmentAnchors(nodes, input.excludeId ?? movingId, input.levelId ?? null)

  // In non-magnetic modes nothing pulls the point onto a guide, so restrict
  // alignment to anchors already within connect distance — a corner then reads
  // no differently from any other nearby point, and far corners stop lighting up
  // from across the plan. Magnetic ('lines') keeps the full-range guides since
  // its snap closes the gap. Mirrors the wall draft/endpoint tools. Filtering the
  // candidates (both local-frame, like `basePoint`) rather than the resolved
  // guides avoids the floor-plan view rotation baked into the guide coords.
  const candidates = magnetic
    ? allCandidates
    : allCandidates.filter(
        (candidate) =>
          distanceSquared(basePoint, [candidate.x, candidate.z]) <= WALL_CONNECT_SNAP_RADIUS ** 2,
      )

  if (candidates.length === 0) {
    useAlignmentGuides.getState().clear()
    return { point: basePoint, wallSnap: null, guides: [], wallIds: [] }
  }

  const alignment = resolveAlignmentForFloorplanView({
    moving: [{ nodeId: movingId, kind: 'corner', x: basePoint[0], z: basePoint[1] }],
    candidates,
    threshold: input.threshold ?? SURFACE_ALIGNMENT_THRESHOLD_M,
  })

  useAlignmentGuides.getState().set(alignment.guides)

  if (!alignment.snap || !magnetic) {
    return { point: basePoint, wallSnap: null, guides: alignment.guides, wallIds: [] }
  }

  return {
    point: [basePoint[0] + alignment.snap.dx, basePoint[1] + alignment.snap.dz],
    wallSnap: null,
    guides: alignment.guides,
    wallIds: [],
  }
}
