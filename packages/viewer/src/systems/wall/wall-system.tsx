import {
  type AnyNode,
  type AnyNodeId,
  buildWallFinishLayout,
  containsPoint,
  DEFAULT_LEVEL_HEIGHT,
  type DoorNode,
  getAdjacentWallIds,
  getEffectiveNode,
  getOpeningWallCut,
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceOffsets,
  getWallLevelZones,
  getWallMiterBoundaryPoints,
  getWallPlaneTop,
  getWallPlanFootprint,
  getWallSurfacePolygon,
  getWallThickness,
  isCurvedWall,
  type Point2D,
  pointToKey,
  resolveLevelId,
  resolveWallFaceBottom,
  resolveWallFinish,
  resolveWallTop,
  sceneRegistry,
  spatialGridManager,
  terrainSupportLift,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallFinishLayout,
  type WallMiterData,
  type WallNode,
  type WallSlabSupport,
  type WallSlabSupportSegment,
  type WindowNode,
  wallFinishMaterialIndex,
  type ZoneNode,
  zoneHasWallFinish,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { ensureRenderableGeometryAttributes, prepareBrushForCSG } from '../../lib/csg-utils'
import { setGroupsSortedByMaterial } from '../../lib/geometry-groups'
import { timeSpan } from '../../lib/perf-tracks'
import { buildTerrainPerimeterFillGeometry } from '../../lib/terrain-perimeter-fill'
import { clearLevelMiterCache, getCachedLevelMiters } from './level-miter-cache'
import {
  buildOpeningCutoutGeometry,
  getOpeningCutoutBottomPadding,
} from './opening-cutout-geometry'
import {
  drainStats,
  endInitialBuild,
  initiallyBuiltWalls,
  isWallInitialBuildActive,
  pendingAdjacentByLevel,
  publishWallDrainStats,
} from './wall-build-lifecycle'
import {
  getWallFaceBaseAt,
  type WallFaceBaseRun,
  type WallFinishGeometryData,
} from './wall-finish-data'
import { sweepUnbuiltWalls, WALL_PLACEHOLDER_SWEEP_INTERVAL } from './wall-placeholder-sweep'
import { notifyWallRebuilt } from './wall-rebuild-notifications'

export { isWallInitialBuildActive } from './wall-build-lifecycle'
export { drainRebuiltWalls } from './wall-rebuild-notifications'

// Reusable CSG evaluator for better performance
const csgEvaluator = new Evaluator()
csgEvaluator.attributes = ['position', 'normal', 'uv', 'uv2']
const CURVED_WALL_3D_ENDPOINT_INSET = 0.0015
const WALL_FACE_NORMAL_Y_EPSILON = 0.6
const WALL_FACE_EDGE_DISTANCE_EPSILON = 0.003
const WALL_BAND_SPLIT_EPSILON = 1e-5

function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

function csgGeometry(brush: Brush): THREE.BufferGeometry {
  return brush.geometry as unknown as THREE.BufferGeometry
}

function isBoxCutout(brush: Brush, bounds: THREE.Box3): boolean {
  const geometry = csgGeometry(brush)
  const positions = geometry.getAttribute('position')
  if ((geometry.index?.count ?? positions.count) !== 36) return false

  const vertex = new THREE.Vector3()
  const corners = new Set<number>()
  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index).applyMatrix4(brush.matrixWorld)
    let corner = 0
    for (const [bit, axis] of ['x', 'y', 'z'].entries()) {
      const coordinate = axis as 'x' | 'y' | 'z'
      if (Math.abs(vertex[coordinate] - bounds.min[coordinate]) <= 1e-6) continue
      if (Math.abs(vertex[coordinate] - bounds.max[coordinate]) > 1e-6) return false
      corner |= 1 << bit
    }
    corners.add(corner)
  }
  // A rotated box's AABB can contain another cutter without the solid doing so.
  return corners.size === 8
}

export function mergeWallCutoutBrushes(brushes: readonly Brush[]): {
  cutter: Brush | null
  fallbackBrushes: Brush[]
  droppedCount: number
} {
  const cutouts = brushes.map((brush) => {
    prepareBrushForCSG(brush)
    const geometry = csgGeometry(brush)
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox!.clone().applyMatrix4(brush.matrixWorld)
    return {
      brush,
      bounds,
      containerBounds: bounds.clone().expandByScalar(1e-5),
      isBox: isBoxCutout(brush, bounds),
    }
  })
  const retained: typeof cutouts = []
  for (const cutout of cutouts) {
    if (cutout.isBox) {
      if (
        retained.some((other) => other.isBox && other.containerBounds.containsBox(cutout.bounds))
      ) {
        continue
      }
      for (let index = retained.length - 1; index >= 0; index--) {
        const other = retained[index]!
        if (other.isBox && cutout.containerBounds.containsBox(other.bounds)) {
          retained.splice(index, 1)
        }
      }
    }
    retained.push(cutout)
  }
  const droppedCount = cutouts.length - retained.length
  const bounds = retained.map((cutout) => cutout.bounds.clone().expandByScalar(1e-6))
  const parents = retained.map((_, index) => index)
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!
      index = parents[index]!
    }
    return index
  }
  for (let a = 0; a < retained.length; a++) {
    for (let b = a + 1; b < retained.length; b++) {
      if (bounds[a]!.intersectsBox(bounds[b]!)) parents[root(b)] = root(a)
    }
  }
  const groups = new Map<number, Brush[]>()
  retained.forEach(({ brush }, index) => {
    const key = root(index)
    const group = groups.get(key) ?? []
    group.push(brush)
    groups.set(key, group)
  })

  const geometries: THREE.BufferGeometry[] = []
  const intermediateGeometries = new Set<THREE.BufferGeometry>()
  const fallbackBrushes: Brush[] = []
  try {
    for (const group of groups.values()) {
      // Long unions of coplanar openings can grow explosively; subtract these directly.
      if (group.length > 4) {
        fallbackBrushes.push(...group)
        continue
      }
      let result = group[0]!
      for (let index = 1; index < group.length; index++) {
        const next = csgEvaluator.evaluate(result, group[index]!, ADDITION)
        intermediateGeometries.add(csgGeometry(next))
        if (intermediateGeometries.delete(csgGeometry(result))) csgGeometry(result).dispose()
        result = next
      }
      const source = csgGeometry(result)
      const geometry = source.index ? source.toNonIndexed() : source.clone()
      geometries.push(geometry)
      geometry.applyMatrix4(result.matrixWorld)
      for (const attribute of Object.keys(geometry.attributes)) {
        if (!csgEvaluator.attributes.includes(attribute)) geometry.deleteAttribute(attribute)
      }
    }

    if (geometries.length === 0) return { cutter: null, fallbackBrushes, droppedCount }

    // CSG material indices are temporary: assignWallMaterialGroups classifies
    // the final faces, including reveals, into the wall's semantic slots.
    const merged = mergeGeometries(geometries, false)
    if (!merged) throw new Error('Unable to merge wall cutout geometries')
    const cutter = new Brush(merged)
    prepareBrushForCSG(cutter)
    return { cutter, fallbackBrushes, droppedCount }
  } finally {
    for (const geometry of geometries) geometry.dispose()
    for (const geometry of intermediateGeometries) geometry.dispose()
  }
}

type WallBoundaryEdgeTag = 'front' | 'back' | 'base'

type TaggedWallBoundaryEdge = {
  start: THREE.Vector2
  end: THREE.Vector2
  tag: WallBoundaryEdgeTag
}

function insetCurvedWallBoundaryPointsFor3D(
  wall: WallNode,
  boundaryPoints: ReturnType<typeof getWallMiterBoundaryPoints>,
  miterData: WallMiterData,
) {
  if (!(boundaryPoints && isCurvedWall(wall))) {
    return boundaryPoints
  }

  const insetDistance = Math.min(
    CURVED_WALL_3D_ENDPOINT_INSET,
    Math.max((wall.thickness ?? 0.1) * 0.01, 0.0005),
  )

  if (insetDistance <= 0) {
    return boundaryPoints
  }

  const next = { ...boundaryPoints }
  const startJunction = miterData.junctions.get(pointToKey({ x: wall.start[0], y: wall.start[1] }))
  const endJunction = miterData.junctions.get(pointToKey({ x: wall.end[0], y: wall.end[1] }))

  if (startJunction && startJunction.connectedWalls.length > 1) {
    const frame = getWallCurveFrameAt(wall, 0)
    next.startLeft = {
      x: next.startLeft.x + frame.tangent.x * insetDistance,
      y: next.startLeft.y + frame.tangent.y * insetDistance,
    }
    next.startRight = {
      x: next.startRight.x + frame.tangent.x * insetDistance,
      y: next.startRight.y + frame.tangent.y * insetDistance,
    }
  }

  if (endJunction && endJunction.connectedWalls.length > 1) {
    const frame = getWallCurveFrameAt(wall, 1)
    next.endLeft = {
      x: next.endLeft.x - frame.tangent.x * insetDistance,
      y: next.endLeft.y - frame.tangent.y * insetDistance,
    }
    next.endRight = {
      x: next.endRight.x - frame.tangent.x * insetDistance,
      y: next.endRight.y - frame.tangent.y * insetDistance,
    }
  }

  return next
}

function addTaggedWallBoundaryEdge(
  edges: TaggedWallBoundaryEdge[],
  points: { x: number; z: number }[],
  startIndex: number,
  endIndex: number,
  tag: WallBoundaryEdgeTag,
) {
  const start = points[startIndex]
  const end = points[endIndex]
  if (!(start && end)) return
  if (Math.hypot(end.x - start.x, end.z - start.z) < 1e-6) return

  edges.push({
    start: new THREE.Vector2(start.x, start.z),
    end: new THREE.Vector2(end.x, end.z),
    tag,
  })
}

function buildTaggedWallBoundaryEdges(
  wall: WallNode,
  localPoints: { x: number; z: number }[],
  miterData: WallMiterData,
): TaggedWallBoundaryEdge[] {
  if (localPoints.length < 2) return []

  const edges: TaggedWallBoundaryEdge[] = []

  if (isCurvedWall(wall)) {
    const sidePointCount = Math.floor(localPoints.length / 2)
    if (sidePointCount < 2) return edges

    for (let index = 0; index < sidePointCount - 1; index += 1) {
      addTaggedWallBoundaryEdge(edges, localPoints, index, index + 1, 'back')
    }

    addTaggedWallBoundaryEdge(edges, localPoints, sidePointCount - 1, sidePointCount, 'base')

    for (let index = sidePointCount; index < localPoints.length - 1; index += 1) {
      addTaggedWallBoundaryEdge(edges, localPoints, index, index + 1, 'front')
    }

    addTaggedWallBoundaryEdge(edges, localPoints, localPoints.length - 1, 0, 'base')
    return edges
  }

  const startKey = pointToKey({ x: wall.start[0], y: wall.start[1] })
  const startJunction = miterData.junctionData.get(startKey)?.get(wall.id)
  const startLeftIndex = startJunction ? localPoints.length - 2 : localPoints.length - 1
  const endLeftIndex = startJunction ? localPoints.length - 3 : localPoints.length - 2

  addTaggedWallBoundaryEdge(edges, localPoints, 0, 1, 'back')

  for (let index = 1; index < endLeftIndex; index += 1) {
    addTaggedWallBoundaryEdge(edges, localPoints, index, index + 1, 'base')
  }

  addTaggedWallBoundaryEdge(edges, localPoints, endLeftIndex, startLeftIndex, 'front')

  for (let index = startLeftIndex; index < localPoints.length - 1; index += 1) {
    addTaggedWallBoundaryEdge(edges, localPoints, index, index + 1, 'base')
  }

  addTaggedWallBoundaryEdge(edges, localPoints, localPoints.length - 1, 0, 'base')

  return edges
}

function distanceToWallBoundaryEdge(point: THREE.Vector2, edge: TaggedWallBoundaryEdge): number {
  const edgeDx = edge.end.x - edge.start.x
  const edgeDz = edge.end.y - edge.start.y
  const pointDx = point.x - edge.start.x
  const pointDz = point.y - edge.start.y
  const edgeLengthSq = edgeDx * edgeDx + edgeDz * edgeDz

  if (edgeLengthSq < 1e-12) {
    return point.distanceTo(edge.start)
  }

  const t = THREE.MathUtils.clamp((pointDx * edgeDx + pointDz * edgeDz) / edgeLengthSq, 0, 1)
  const closestX = edge.start.x + edgeDx * t
  const closestZ = edge.start.y + edgeDz * t

  return Math.hypot(point.x - closestX, point.y - closestZ)
}

/**
 * What decides a face triangle's material: the wall's finish layout (regions and
 * room spans) and, where the faces stand on different floors, each face's base —
 * region heights are measured from the face's own base.
 */
export type WallFinishContext = {
  layout: WallFinishLayout
  faceBase: Record<'a' | 'b', WallFaceBaseRun[]> | null
  /** The palette's finish refs (material indices 3..): the layout's, then the foundation's. */
  refs: readonly string[]
  /** The underpinning's stemwall: triangles below local y `top` take material `index`. */
  foundation: { index: number; top: number } | null
}

function getWallFaceMaterialIndex(
  context: WallFinishContext,
  face: 'a' | 'b',
  x: number,
  y: number,
): number {
  const { layout, foundation } = context
  // The underpinning's stemwall: everything under the rim depth is concrete.
  if (foundation && y < foundation.top + WALL_BAND_SPLIT_EPSILON) return foundation.index
  if (layout.plain) return face === 'a' ? 1 : 2
  const hit = resolveWallFinish(layout, face, x, y - getWallFaceBaseAt(context, face, x))
  return wallFinishMaterialIndex(layout, face, hit)
}

function assignWallMaterialGroups(
  geometry: THREE.BufferGeometry,
  wall: WallNode,
  boundaryEdges: TaggedWallBoundaryEdge[],
  finish: WallFinishContext,
) {
  const position = geometry.getAttribute('position')
  if (!position) return

  const index = geometry.getIndex()
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3)
  if (triangleCount === 0) {
    geometry.clearGroups()
    return
  }

  const triangleMaterials = new Array<number>(triangleCount).fill(0)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const projectedCentroid = new THREE.Vector2()
  const maxBoundaryDistance = Math.max(
    getWallThickness(wall) * 0.02,
    WALL_FACE_EDGE_DISTANCE_EPSILON,
  )

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const baseIndex = triangleIndex * 3
    const ia = index ? index.getX(baseIndex) : baseIndex
    const ib = index ? index.getX(baseIndex + 1) : baseIndex + 1
    const ic = index ? index.getX(baseIndex + 2) : baseIndex + 2

    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)

    ab.subVectors(b, a)
    ac.subVectors(c, a)
    normal.crossVectors(ab, ac)

    if (normal.lengthSq() < 1e-12) {
      triangleMaterials[triangleIndex] = 0
      continue
    }

    normal.normalize()

    if (Math.abs(normal.y) >= WALL_FACE_NORMAL_Y_EPSILON) {
      triangleMaterials[triangleIndex] = 0
      continue
    }

    centroid
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
    projectedCentroid.set(centroid.x, centroid.z)

    let nearestTag: WallBoundaryEdgeTag | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const edge of boundaryEdges) {
      const distance = distanceToWallBoundaryEdge(projectedCentroid, edge)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestTag = edge.tag
      }
    }

    if (!nearestTag || nearestDistance > maxBoundaryDistance) {
      triangleMaterials[triangleIndex] = 0
      continue
    }

    if (nearestTag === 'base') {
      triangleMaterials[triangleIndex] = 0
      continue
    }

    triangleMaterials[triangleIndex] = getWallFaceMaterialIndex(
      finish,
      nearestTag === 'front' ? 'a' : 'b',
      centroid.x,
      centroid.y,
    )
  }

  setGroupsSortedByMaterial(geometry, triangleMaterials)
}

type SplitVertex = {
  x: number
  y: number
  z: number
}

function interpolateSplitVertex(a: SplitVertex, b: SplitVertex, t: number): SplitVertex {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

function clipPolygonByPlane(
  polygon: SplitVertex[],
  axis: 'x' | 'y',
  plane: number,
  keepBelow: boolean,
): SplitVertex[] {
  const out: SplitVertex[] = []
  if (polygon.length === 0) return out

  const isInside = (vertex: SplitVertex) =>
    keepBelow
      ? vertex[axis] <= plane + WALL_BAND_SPLIT_EPSILON
      : vertex[axis] >= plane - WALL_BAND_SPLIT_EPSILON

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!
    const currentInside = isInside(current)
    const previousInside = isInside(previous)

    if (currentInside !== previousInside) {
      const denom = current[axis] - previous[axis]
      if (Math.abs(denom) > WALL_BAND_SPLIT_EPSILON) {
        out.push(interpolateSplitVertex(previous, current, (plane - previous[axis]) / denom))
      }
    }
    if (currentInside) out.push(current)
  }

  return out
}

function triangulateSplitPolygon(polygon: SplitVertex[], positions: number[]) {
  if (polygon.length < 3) return
  const first = polygon[0]!
  for (let index = 1; index < polygon.length - 1; index += 1) {
    const b = polygon[index]!
    const c = polygon[index + 1]!
    positions.push(first.x, first.y, first.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }
}

function normalizeSplitPlanes(planes: readonly number[]): number[] {
  return Array.from(
    new Set(
      planes
        .filter((plane) => Number.isFinite(plane))
        .map((plane) => Math.round(plane / WALL_BAND_SPLIT_EPSILON) * WALL_BAND_SPLIT_EPSILON),
    ),
  ).sort((a, b) => a - b)
}

/**
 * Cuts triangles at the vertical planes `x = const` (wall-local stations) and
 * horizontal planes `y = const`, so each piece lies in one finish cell. With no
 * planes the geometry is returned untouched — plain walls never pay for this.
 */
function splitGeometryAtPlanes(
  geometry: THREE.BufferGeometry,
  yPlanes: readonly number[],
  xPlanes: readonly number[] = [],
): THREE.BufferGeometry {
  const cuts = [
    ...normalizeSplitPlanes(xPlanes).map((plane) => ({ axis: 'x' as const, plane })),
    ...normalizeSplitPlanes(yPlanes).map((plane) => ({ axis: 'y' as const, plane })),
  ]
  if (cuts.length === 0) return geometry

  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  if (!position || position.count === 0) return source

  const positions: number[] = []
  for (let index = 0; index < position.count; index += 3) {
    let polygons: SplitVertex[][] = [
      [
        { x: position.getX(index), y: position.getY(index), z: position.getZ(index) },
        { x: position.getX(index + 1), y: position.getY(index + 1), z: position.getZ(index + 1) },
        { x: position.getX(index + 2), y: position.getY(index + 2), z: position.getZ(index + 2) },
      ],
    ]

    for (const { axis, plane } of cuts) {
      const next: SplitVertex[][] = []
      for (const polygon of polygons) {
        const min = Math.min(...polygon.map((vertex) => vertex[axis]))
        const max = Math.max(...polygon.map((vertex) => vertex[axis]))
        if (plane <= min + WALL_BAND_SPLIT_EPSILON || plane >= max - WALL_BAND_SPLIT_EPSILON) {
          next.push(polygon)
          continue
        }

        const below = clipPolygonByPlane(polygon, axis, plane, true)
        const above = clipPolygonByPlane(polygon, axis, plane, false)
        if (below.length >= 3) next.push(below)
        if (above.length >= 3) next.push(above)
      }
      polygons = next
    }

    for (const polygon of polygons) triangulateSplitPolygon(polygon, positions)
  }

  if (source !== geometry) geometry.dispose()
  source.dispose()

  const split = new THREE.BufferGeometry()
  split.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  split.computeVertexNormals()
  return split
}

/** Split planes a finish layout needs, in wall-local coordinates. */
function getWallFinishSplitPlanes(finish: WallFinishContext): { x: number[]; y: number[] } {
  const { layout, faceBase } = finish
  if (layout.plain) return { x: [], y: [] }
  const x = [...layout.uSplits]
  const bases = new Set<number>([0])
  if (faceBase && layout.vSplits.length > 0) {
    bases.clear()
    for (const run of [...faceBase.a, ...faceBase.b]) {
      bases.add(run.y)
      // A face base that steps moves every height with it, so cut at the step too.
      if (run.start > 0) x.push(run.start)
      if (run.end < layout.length) x.push(run.end)
    }
  }
  const y = [...bases].flatMap((base) => layout.vSplits.map((v) => base + v))
  return { x, y }
}

// ============================================================================
// WALL SYSTEM
// ============================================================================

let useFrameNb = 0

// ─── Drag-throttle state (singleton — one WallSystem mounted globally) ──
//
// Endpoint drags fire `markDirty(wallId)` on every pointermove tick. Without
// throttling, each tick rebuilds the dragged wall (~1 CSG + miter pass) AND
// every adjacent wall sharing a corner (3–4× in a t-junction or room).
// Visible as drag lag, especially on walls with door/window cutouts.
//
// Strategy: rebuild the dragged wall every tick (so the drag follows the
// cursor with full fidelity), but defer adjacent rebuilds to a trailing-
// edge flush DRAG_FLUSH_MS after the dirty stream stops. Visually, neighbor
// corners stay at their pre-drag miter until release, then snap into place
// within ~80ms. Standard CAD-app behavior. Speeds up t-junction drags ~3×,
// 4-corner-room drags ~4×.
const DRAG_FLUSH_MS = 80
const MAX_WALL_REBUILDS_PER_FRAME = 8
const WALL_PROGRESSIVE_DIRTY_THRESHOLD = MAX_WALL_REBUILDS_PER_FRAME
const WALL_PROGRESSIVE_TIME_BUDGET_MS = 8
const HEAVY_WALL_OPENINGS = 6
let lastWallDirtyAtMs = 0
let unmountedFrames = 0
let stalledHydrationToken: object | null = null

function wallRebuildExitReason(
  wallId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  rebuiltThisFrame: number,
  elapsedMs: number,
  initialBuild = false,
): 'cap' | 'budget' | 'heavy' | null {
  if (!initialBuild && rebuiltThisFrame >= MAX_WALL_REBUILDS_PER_FRAME) return 'cap'
  if (rebuiltThisFrame === 0) return null
  if (elapsedMs >= WALL_PROGRESSIVE_TIME_BUDGET_MS) return 'budget'
  const wall = nodes[wallId as AnyNodeId]
  if (wall?.type !== 'wall') return null
  let cutouts = 0
  for (const childId of getEffectiveWall(wall).children ?? []) {
    const child = nodes[childId]
    if (
      child?.type === 'door' ||
      child?.type === 'window' ||
      (child?.type === 'item' &&
        (
          sceneRegistry.nodes.get(childId)?.getObjectByName('cutout') as THREE.Mesh | undefined
        )?.geometry?.getAttribute('position')?.count)
    ) {
      cutouts++
      if (cutouts >= HEAVY_WALL_OPENINGS) return 'heavy'
    }
  }
  return null
}

export function shouldDeferWallRebuild(
  wallId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  rebuiltThisFrame: number,
  elapsedMs: number,
): boolean {
  return wallRebuildExitReason(wallId, nodes, rebuiltThisFrame, elapsedMs) !== null
}

/** Rebuilds this system still owes — neighbours deferred during a drag. */
export function getPendingWallRebuildCount(): number {
  return drainStats.pendingNeighbours
}

let placeholderSweepCountdown = WALL_PLACEHOLDER_SWEEP_INTERVAL

export type WallGeometryAdapterContext = {
  isLive: (id: AnyNodeId) => boolean
}

export type WallGeometryAdapter = {
  prepareChildren?: (
    wall: WallNode,
    children: readonly AnyNode[],
    context: WallGeometryAdapterContext,
  ) => { envelopeChildren: AnyNode[]; renderChildren: AnyNode[] }
  buildGeometry?: (
    wall: WallNode,
    envelope: THREE.BufferGeometry,
    children: readonly AnyNode[],
  ) => THREE.BufferGeometry
  syncAuxiliaryGeometry?: (wall: WallNode, mesh: THREE.Mesh, geometry: THREE.BufferGeometry) => void
}

export const WallSystem = ({ geometryAdapter }: { geometryAdapter?: WallGeometryAdapter } = {}) => {
  useScene((state) => state.dirtyNodes)
  useLiveNodeOverrides((s) => s.overrides)
  useEffect(
    () => () => {
      clearLevelMiterCache()
      zoneFinishRecords.clear()
      zoneFinishNodes = null
      levelZones.clear()
      levelZonesNodes = null
    },
    [],
  )
  useFrame(() => runWallBuildFrame(geometryAdapter), 4)
  return null
}

export function runWallBuildFrame(geometryAdapter?: WallGeometryAdapter) {
  const initialBuild = isWallInitialBuildActive()
  const token = useScene.getState().hydrationToken
  if (token !== stalledHydrationToken) {
    unmountedFrames = 0
    stalledHydrationToken = token
  }
  drainStats.wallsConsumedThisFrame = 0
  try {
    consumeWallBuildFrame(initialBuild, geometryAdapter)
  } finally {
    publishWallDrainStats()
  }
}

// Zones per level for the current scene snapshot: a floor's walls rebuild
// together, and each one would otherwise rescan the level's children.
const levelZones = new Map<string, ZoneNode[]>()
let levelZonesNodes: Record<AnyNodeId, AnyNode> | null = null

function getCachedLevelZones(wall: WallNode, nodes: Record<AnyNodeId, AnyNode>): ZoneNode[] {
  if (nodes !== levelZonesNodes) {
    levelZones.clear()
    levelZonesNodes = nodes
  }
  const key = wall.parentId ?? ''
  let zones = levelZones.get(key)
  if (!zones) {
    zones = getWallLevelZones(wall, nodes)
    levelZones.set(key, zones)
  }
  return zones
}

type ZoneFinishRecord = { zone: ZoneNode; signature: string | null }
const zoneFinishRecords = new Map<string, ZoneFinishRecord>()
let zoneFinishNodes: Record<AnyNodeId, AnyNode> | null = null

function zoneFinishSignature(zone: ZoneNode): string | null {
  const painted = zoneHasWallFinish(zone)
  if (!painted && zone.floor?.elevation === undefined) return null
  return JSON.stringify([
    zone.parentId,
    zone.floor?.elevation,
    zone.wallMaterial,
    zone.wallOverrides,
    // A floor-only room reshape does not change the datum of every boundary wall.
    // Endpoint edits already invalidate their walls and queue adjacent miters.
    painted ? zone.polygon : undefined,
    painted ? zone.holes : undefined,
    zone.boundaryWallIds,
  ])
}

/**
 * A room's wall finish lives on its zone, so a zone edit must rebuild the walls
 * bounding it — the old boundary and the new one. Zones without a wall finish
 * never touch their walls, so ordinary room edits cost nothing here.
 */
export function markWallsForZoneFinishChanges(): void {
  const state = useScene.getState()
  const nodes = state.nodes
  if (nodes === zoneFinishNodes) return
  zoneFinishNodes = nodes
  const walls = new Set<string>()
  const seen = new Set<string>()
  const collect = (zone: ZoneNode) => {
    for (const id of zone.boundaryWallIds ?? []) walls.add(id)
    for (const entry of zone.wallOverrides ?? []) walls.add(entry.wallId)
  }
  for (const id in nodes) {
    const node = nodes[id as AnyNodeId]
    if (node?.type !== 'zone') continue
    seen.add(id)
    const previous = zoneFinishRecords.get(id)
    if (previous?.zone === node) continue
    const signature = zoneFinishSignature(node)
    if (signature !== (previous?.signature ?? null)) {
      if (previous) collect(previous.zone)
      collect(node)
    }
    zoneFinishRecords.set(id, { zone: node, signature })
  }
  for (const [id, record] of zoneFinishRecords) {
    if (seen.has(id)) continue
    if (record.signature !== null) collect(record.zone)
    zoneFinishRecords.delete(id)
  }
  for (const id of walls) {
    const wall = nodes[id as AnyNodeId]
    if (wall?.type === 'wall') {
      state.markDirty(wall.id)
      for (const child of wall.children) state.markDirty(child)
    }
  }
}

function consumeWallBuildFrame(initialBuild: boolean, geometryAdapter?: WallGeometryAdapter) {
  markWallsForZoneFinishChanges()
  const clearDirty = useScene.getState().clearDirty
  // Self-heal: any registered wall still on its mount-time placeholder
  // geometry with NO dirty mark gets re-marked, so a lost mark (system
  // mounted late, suspense remount, mark consumed elsewhere) can never
  // strand a wall as a degenerate point forever (QA f2 probe5/probe6 —
  // scene loaded with the X-ray active never built any of its 24 walls).
  placeholderSweepCountdown -= 1
  if (placeholderSweepCountdown <= 0) {
    placeholderSweepCountdown = WALL_PLACEHOLDER_SWEEP_INTERVAL
    const sceneState = useScene.getState()
    sweepUnbuiltWalls({
      wallIds: sceneRegistry.byType.wall ?? [],
      geometryOf: (wallId) =>
        (sceneRegistry.nodes.get(wallId) as THREE.Mesh | undefined)?.geometry ?? null,
      isDirty: (wallId) => sceneState.dirtyNodes.has(wallId as AnyNodeId),
      markDirty: (wallId) => sceneState.markDirty(wallId as AnyNodeId),
    })
  }

  const dirtyNodes = useScene.getState().dirtyNodes
  const hasDirty = dirtyNodes.size > 0
  const hasPending = pendingAdjacentByLevel.size > 0
  if (!(hasDirty || hasPending)) {
    endInitialBuild()
    return
  }

  const nodes = useScene.getState().nodes
  const now = performance.now()

  // Collect dirty walls and their levels
  const dirtyWallsByLevel = new Map<string, Set<string>>()
  let dirtyWallCount = 0
  let unmountedWallCount = 0

  useFrameNb += 1
  if (hasDirty) {
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (node?.type !== 'wall') return

      dirtyWallCount += 1
      if (!sceneRegistry.nodes.has(id)) unmountedWallCount++
      const levelId = node.parentId
      if (!levelId) return

      if (!dirtyWallsByLevel.has(levelId)) {
        dirtyWallsByLevel.set(levelId, new Set())
      }
      dirtyWallsByLevel.get(levelId)?.add(id)
    })
  }

  const hasDirtyWalls = dirtyWallCount > unmountedWallCount
  if (hasDirtyWalls) {
    lastWallDirtyAtMs = now
  }

  const useProgressiveWallRebuilds =
    initialBuild || dirtyWallCount > WALL_PROGRESSIVE_DIRTY_THRESHOLD
  let rebuiltWallsThisFrame = 0
  const rebuildFrameStartedAt = now
  let deferWallRebuilds = false
  let exitReason: 'cap' | 'budget' | 'heavy' | null = null

  // Process each level that has dirty walls
  for (const [levelId, dirtyWallIds] of dirtyWallsByLevel) {
    if (
      !initialBuild &&
      useProgressiveWallRebuilds &&
      rebuiltWallsThisFrame >= MAX_WALL_REBUILDS_PER_FRAME
    ) {
      exitReason = 'cap'
      break
    }
    const levelWalls = getLevelWalls(levelId)
    const miterData = timeSpan('wall-miter', () => getCachedLevelMiters(levelId, levelWalls))
    const rebuiltWallIds = new Set<string>()

    // Update dirty walls — always, no throttling. The dragged wall must
    // follow the cursor with full fidelity (cutouts and all). Large imports
    // enter the progressive path so initial load can't lock the tab.
    for (const wallId of dirtyWallIds) {
      exitReason = useProgressiveWallRebuilds
        ? wallRebuildExitReason(
            wallId,
            nodes,
            rebuiltWallsThisFrame,
            performance.now() - rebuildFrameStartedAt,
            initialBuild,
          )
        : null
      if (exitReason) {
        deferWallRebuilds = true
        break
      }

      const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
      if (mesh) {
        timeSpan('wall-rebuild', () => updateWallGeometry(wallId, miterData, geometryAdapter), {
          properties: [['node', wallId]],
        })
        clearDirty(wallId as AnyNodeId)
        notifyWallRebuilt(wallId)
        const firstBuild = !initiallyBuiltWalls.has(wallId)
        if (firstBuild) {
          initiallyBuiltWalls.add(wallId)
          drainStats.firstBuilds++
        } else {
          drainStats.reinvalidationBuilds++
        }
        if (!(initialBuild && firstBuild)) rebuiltWallIds.add(wallId)
        rebuiltWallsThisFrame += 1
        drainStats.wallsConsumedThisFrame++
        if (initialBuild && wallRebuildExitReason(wallId, nodes, 1, 0, true) === 'heavy') {
          exitReason = 'heavy'
          deferWallRebuilds = true
          break
        }
      }
      // If mesh not found, keep it dirty for next frame
    }

    if (rebuiltWallIds.size === 0) {
      if (deferWallRebuilds) break
      continue
    }

    // First builds use the same hydrated inputs as every queued neighbour.
    // Only subsequent invalidations need the adjacency scan and trailing flush.
    // Adjacent walls sharing junctions — *defer* during active drag
    // (dirty arrived this frame), flush on the trailing edge.
    const adjacentWallIds = getAdjacentWallIds(levelWalls, rebuiltWallIds)
    let pending = pendingAdjacentByLevel.get(levelId)
    if (!pending) {
      pending = new Set()
      pendingAdjacentByLevel.set(levelId, pending)
    }
    for (const wallId of adjacentWallIds) {
      if (!(dirtyWallIds.has(wallId) || pending.has(wallId))) {
        pending.add(wallId)
        drainStats.pendingNeighbours++
        drainStats.neighbourEnqueues++
      }
    }
    if (pending.size === 0) pendingAdjacentByLevel.delete(levelId)
    if (deferWallRebuilds) break
  }

  // Trailing-edge flush: if no new dirty marks for DRAG_FLUSH_MS, the
  // drag has ended — rebuild the queued neighbors so corners snap into
  // their correct miter joins.
  const quiet = !hasDirtyWalls && now - lastWallDirtyAtMs >= DRAG_FLUSH_MS
  if (quiet && pendingAdjacentByLevel.size > 0) {
    const pendingCount = getPendingWallRebuildCount()
    const useProgressiveAdjacentRebuilds =
      initialBuild || pendingCount > WALL_PROGRESSIVE_DIRTY_THRESHOLD
    let rebuiltAdjacentThisFrame = 0
    const adjacentFrameStartedAt = performance.now()
    let deferAdjacentRebuilds = false

    for (const [levelId, pendingIds] of pendingAdjacentByLevel) {
      if (pendingIds.size === 0) continue
      const levelWalls = getLevelWalls(levelId)
      const miterData = timeSpan('wall-miter', () => getCachedLevelMiters(levelId, levelWalls))
      for (const wallId of Array.from(pendingIds)) {
        exitReason = useProgressiveAdjacentRebuilds
          ? wallRebuildExitReason(
              wallId,
              nodes,
              rebuiltAdjacentThisFrame,
              performance.now() - adjacentFrameStartedAt,
              initialBuild,
            )
          : null
        if (exitReason) {
          deferAdjacentRebuilds = true
          break
        }

        const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
        if (mesh) {
          timeSpan('wall-rebuild', () => updateWallGeometry(wallId, miterData, geometryAdapter), {
            properties: [['node', wallId]],
          })
          notifyWallRebuilt(wallId)
          drainStats.wallsConsumedThisFrame++
          if (initiallyBuiltWalls.has(wallId)) drainStats.reinvalidationBuilds++
          else {
            initiallyBuiltWalls.add(wallId)
            drainStats.firstBuilds++
          }
        }
        pendingIds.delete(wallId)
        drainStats.pendingNeighbours--
        rebuiltAdjacentThisFrame += 1
        if (initialBuild && wallRebuildExitReason(wallId, nodes, 1, 0, true) === 'heavy') {
          exitReason = 'heavy'
          deferAdjacentRebuilds = true
          break
        }
      }

      if (pendingIds.size === 0) {
        pendingAdjacentByLevel.delete(levelId)
      }

      if (
        deferAdjacentRebuilds ||
        (!initialBuild &&
          useProgressiveAdjacentRebuilds &&
          rebuiltAdjacentThisFrame >= MAX_WALL_REBUILDS_PER_FRAME)
      ) {
        break
      }
    }
  }
  if (initialBuild && drainStats.wallsConsumedThisFrame === 0 && unmountedWallCount > 0) {
    unmountedFrames++
    if (unmountedFrames >= WALL_PLACEHOLDER_SWEEP_INTERVAL) {
      useScene.getState().invalidateHydration()
    }
  } else unmountedFrames = 0
  if (exitReason === 'budget') drainStats.budgetExits++
  else if (exitReason === 'heavy') drainStats.heavyExits++
  else if (exitReason === 'cap') drainStats.capExits++
  if (dirtyWallCount === rebuiltWallsThisFrame && drainStats.pendingNeighbours === 0) {
    if (drainStats.wallsConsumedThisFrame > 0 || drainStats.initialBuildActive)
      drainStats.drainedExits++
    endInitialBuild()
  }
}

/**
 * Merge any live override for a wall into the scene record. Lets the
 * 2D move handler publish `{ start, end, curveOffset }` to
 * `useLiveNodeOverrides` and have the geometry / miter pipeline use
 * those values without zustand churn during the drag. When no
 * override is set, the wall is returned unchanged.
 */
function getEffectiveWall(wall: WallNode): WallNode {
  const override = useLiveNodeOverrides.getState().get(wall.id)
  if (!override || Object.keys(override).length === 0) return wall
  return { ...wall, ...override } as WallNode
}

/**
 * Gets all walls that belong to a level, with any live overrides
 * merged in so miters compute against the cursor-driven positions
 * (not the pre-drag scene state).
 */
function getLevelWalls(levelId: string): WallNode[] {
  const { nodes } = useScene.getState()
  const level = nodes[levelId as AnyNodeId]

  if (level?.type !== 'level') return []

  const walls: WallNode[] = []
  for (const childId of level.children) {
    const child = nodes[childId]
    if (child?.type === 'wall') {
      walls.push(getEffectiveWall(child as WallNode))
    }
  }

  return walls
}

/**
 * Updates the geometry for a single wall. Reads the effective node
 * (override-merged) so a 2D drag visibly moves the 3D mesh without
 * having touched `useScene` mid-drag.
 */
function updateWallGeometry(
  wallId: string,
  miterData: WallMiterData,
  geometryAdapter?: WallGeometryAdapter,
) {
  const nodes = useScene.getState().nodes
  const sceneNode = nodes[wallId as WallNode['id']]
  if (sceneNode?.type !== 'wall') return
  const node = getEffectiveWall(sceneNode as WallNode)

  const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
  if (!mesh) return

  const levelId = resolveLevelId(node, nodes)
  // Covering-clamped plane: a flush/thick slab on the level above shortens
  // the plane-bound walls below it (explicit-height walls ignore the value).
  const planeTop = getWallPlaneTop(node, levelId, nodes)
  const slabSupport = spatialGridManager.getSlabSupportForWall(
    levelId,
    node.start,
    node.end,
    node.curveOffset ?? 0,
    node.thickness,
    node.supportSlabId,
    undefined,
    node.supportOffset,
    node.justification,
  )
  const slabElevation = slabSupport.elevation

  const childrenIds = node.children || []
  const childrenNodes = childrenIds
    .map((childId) => nodes[childId])
    .filter((n): n is AnyNode => n !== undefined)
    .map((child) => {
      if (child.type !== 'door' && child.type !== 'window') return child
      const effective = getEffectiveNode(child)
      const live = useLiveTransforms.getState().get(child.id)
      return live?.position ? { ...effective, position: live.position } : effective
    })
  const prepared = geometryAdapter?.prepareChildren?.(node, childrenNodes, {
    isLive: (id) =>
      useLiveNodeOverrides.getState().get(id) !== undefined ||
      useLiveTransforms.getState().get(id) !== undefined,
  }) ?? {
    envelopeChildren: childrenNodes,
    renderChildren: childrenNodes,
  }

  const fillMasks = node.fillToTerrain
    ? [
        ...Object.values(nodes).flatMap((slab) =>
          slab.type === 'slab' && slab.parentId === levelId && slab.support !== 'open'
            ? [{ outer: slab.polygon, holes: slab.holes }]
            : [],
        ),
        ...childrenNodes.flatMap((child) =>
          child.type === 'door' || child.type === 'window'
            ? getOpeningWallCut(node, child, nodes, slabSupport).aperture
            : [],
        ),
      ]
    : []
  const terrainBottomAt = node.fillToTerrain
    ? (x: number, z: number) =>
        containsPoint(fillMasks, [x, z]) ? slabElevation : terrainSupportLift(nodes, levelId, x, z)
    : undefined

  const builtGeo = generateExtrudedWall(
    node,
    prepared.envelopeChildren,
    miterData,
    slabElevation,
    slabSupport.baseElevation,
    slabSupport.baseSegments,
    planeTop,
    terrainBottomAt,
    slabSupport.faceDatum,
    buildWallFinishLayout(node, getCachedLevelZones(node, nodes)),
  )
  const wallAngle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  // World transform the render mesh will apply (position + Y-rotation below).
  // Reproduce it here so the UVs can be projected in WORLD space — see
  // `applyWorldPlanarWallUVs`.
  const wallWorldMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(node.start[0], slabElevation, node.start[1]),
    new THREE.Quaternion().setFromAxisAngle(WALL_UV_Y_AXIS, -wallAngle),
    WALL_UV_UNIT_SCALE,
  )
  const renderedGeo =
    geometryAdapter?.buildGeometry?.(node, builtGeo, prepared.renderChildren) ?? builtGeo

  if (node.tilt) {
    // Apply shear directly to the geometry so bounding boxes and CSG read the sheared vertices.
    const shearMatrix = new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, Math.tan(node.tilt))
    renderedGeo.applyMatrix4(shearMatrix)
  }

  const newGeo = applyWorldPlanarWallUVs(renderedGeo, wallWorldMatrix)

  mesh.geometry.dispose()
  // A degenerate rebuild (zero-length or fully cut wall) yields as few vertices
  // as the mount-time placeholder; the stamp keeps the sweep from re-marking it.
  newGeo.userData.built = true
  mesh.geometry = newGeo
  geometryAdapter?.syncAuxiliaryGeometry?.(node, mesh, newGeo)
  // Update collision mesh
  const collisionMesh = mesh.getObjectByName('collision-mesh') as THREE.Mesh
  if (collisionMesh) {
    const collisionGeo = generateExtrudedWall(
      node,
      [],
      miterData,
      slabElevation,
      slabSupport.baseElevation,
      slabSupport.baseSegments,
      planeTop,
      terrainBottomAt,
      slabSupport.faceDatum,
    )
    if (node.tilt) {
      collisionGeo.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, Math.tan(node.tilt)))
    }
    collisionMesh.geometry.dispose()
    collisionMesh.geometry = collisionGeo
  }

  mesh.position.set(node.start[0], slabElevation, node.start[1])
  const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  mesh.rotation.set(0, -angle, 0)
  mesh.matrixAutoUpdate = true

  const offsets = getWallFaceOffsets(node)
  const frameKey = `${offsets.a}:${offsets.b}`
  // Child systems otherwise only see their own edits. Invalidate on a frame
  // change once, avoiding a wall → opening → wall rebuild loop.
  if (mesh.userData.wallFrameKey !== undefined && mesh.userData.wallFrameKey !== frameKey) {
    for (const child of childrenNodes) useScene.getState().markDirty(child.id)
  }
  mesh.userData.wallFrameKey = frameKey
}

const WALL_UV_Y_AXIS = new THREE.Vector3(0, 1, 0)
const WALL_UV_UNIT_SCALE = new THREE.Vector3(1, 1, 1)

/**
 * Re-project a wall's UVs in WORLD space (1 UV unit = 1 m) so the finish tiles
 * continuously across adjacent walls and lines up with the roof gable above —
 * instead of THREE's `ExtrudeGeometry` UVs, which restart at each wall's own
 * start/end. Matches `roof-system`'s `pushRoofUv` projection exactly: vertical
 * faces use `U = ±worldX/Z` (the axis across the face normal) and `V = 1 -
 * worldY`; the thin top/bottom caps use `(worldX, worldZ)`. De-indexes first so
 * every triangle projects by its own face normal (no shared-vertex seams at
 * edges). Applied only to the render mesh; collision/floorplan geometry is
 * untouched.
 */
function applyWorldPlanarWallUVs(
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const target = geometry.index ? geometry.toNonIndexed() : geometry
  if (target !== geometry) {
    target.userData = geometry.userData
    geometry.dispose()
  }

  const position = target.getAttribute('position')
  if (!position || position.count === 0) return target

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edgeAB = new THREE.Vector3()
  const edgeAC = new THREE.Vector3()
  const uvs = new Float32Array(position.count * 2)

  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i).applyMatrix4(worldMatrix)
    b.fromBufferAttribute(position, i + 1).applyMatrix4(worldMatrix)
    c.fromBufferAttribute(position, i + 2).applyMatrix4(worldMatrix)
    edgeAB.subVectors(b, a)
    edgeAC.subVectors(c, a)
    normal.crossVectors(edgeAB, edgeAC).normalize()

    const absX = Math.abs(normal.x)
    const absY = Math.abs(normal.y)
    const absZ = Math.abs(normal.z)

    for (let k = 0; k < 3; k += 1) {
      const p = k === 0 ? a : k === 1 ? b : c
      let u: number
      let v: number
      if (absY >= absX && absY >= absZ) {
        u = p.x
        v = p.z
      } else {
        v = 1 - p.y
        u = absX >= absZ ? (normal.x >= 0 ? p.z : -p.z) : normal.z >= 0 ? p.x : -p.x
      }
      uvs[(i + k) * 2] = u
      uvs[(i + k) * 2 + 1] = v
    }
  }

  target.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  target.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs.slice(), 2))
  return target
}

/**
 * Generates extruded wall geometry with mitering and cutouts
 *
 * Key insight from demo: polygon is built in WORLD coordinates first,
 * then we transform to wall-local for the 3D mesh.
 */
const WALL_TERRAIN_SAMPLE_STEP = 0.25

type WallTerrainBottomSampler = (x: number, z: number) => number | null

function densifyClosedWallPerimeter(points: Point2D[]): Point2D[] {
  const dense: Point2D[] = []
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const segments = Math.max(1, Math.ceil(length / WALL_TERRAIN_SAMPLE_STEP))
    for (let segment = 0; segment < segments; segment += 1) {
      const t = segment / segments
      dense.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      })
    }
  }
  return dense
}

function buildWallTerrainFillGeometry(
  perimeter: Point2D[],
  worldToLocal: (point: Point2D) => { x: number; z: number },
  wallBaseElevation: number,
  terrainBottomAt: WallTerrainBottomSampler,
): THREE.BufferGeometry | null {
  const worldPoints = densifyClosedWallPerimeter(perimeter)
  if (worldPoints.length < 3) return null

  const localPoints = worldPoints.map(worldToLocal)
  const bottomY = worldPoints.map((point) => {
    const terrainElevation = terrainBottomAt(point.x, point.y)
    return terrainElevation == null ? 0 : Math.min(0, terrainElevation - wallBaseElevation)
  })
  return buildTerrainPerimeterFillGeometry(localPoints, bottomY, 0)
}

/**
 * The underpinning under a wall (`WallNode.underpinning`): a skirt of the
 * wall's own faces `rim` deep below the base, then the stemwall skirt from
 * there down `stem` more — or to the terrain wherever that is lower when
 * the wall also fills to terrain. Two fills, split at the rim depth, so the
 * material groups can paint the stem concrete and the rim in the finish.
 */
function buildWallUnderpinningGeometry(
  perimeter: Point2D[],
  worldToLocal: (point: Point2D) => { x: number; z: number },
  wallBaseElevation: number,
  wall: Pick<WallNode, 'underpinning'>,
  terrainBottomAt: WallTerrainBottomSampler | undefined,
  curved = false,
): THREE.BufferGeometry[] {
  const underpinning = wall.underpinning
  if (!underpinning) return []
  const worldPoints = densifyClosedWallPerimeter(perimeter)
  if (worldPoints.length < 3) return []
  const localPoints = worldPoints.map(worldToLocal)
  const rimBottom = -underpinning.rim
  const fills: THREE.BufferGeometry[] = []
  if (underpinning.rim > 1e-6) {
    const rim = buildTerrainPerimeterFillGeometry(
      localPoints,
      worldPoints.map(() => rimBottom),
      0,
    )
    if (rim) fills.push(rim)
  }
  const stemBottom = worldPoints.map((point) => {
    let y = rimBottom - underpinning.stem
    if (terrainBottomAt) {
      const terrainElevation = terrainBottomAt(point.x, point.y)
      if (terrainElevation != null) y = Math.min(y, terrainElevation - wallBaseElevation)
    }
    return y
  })
  if (stemBottom.some((y) => y < rimBottom - 1e-6)) {
    const stem = buildTerrainPerimeterFillGeometry(localPoints, stemBottom, rimBottom)
    if (stem) {
      fills.push(
        underpinning.openings?.length && !curved
          ? cutUnderpinningOpenings(stem, localPoints, rimBottom, underpinning.openings)
          : stem,
      )
    }
  }
  return fills
}

/**
 * The stem skirt with its openings (`WallUnderpinning.openings`) cut through
 * it: the skirt is closed with a cap at its top so it is a solid, then each
 * opening's box is subtracted across the full thickness. The cap lands on
 * the rim's (or the body's) own bottom face, inside the wall.
 */
function cutUnderpinningOpenings(
  stem: THREE.BufferGeometry,
  localPoints: readonly { x: number; z: number }[],
  topY: number,
  openings: NonNullable<NonNullable<WallNode['underpinning']>['openings']>,
): THREE.BufferGeometry {
  const stemPositions = stem.getAttribute('position')
  const positions: number[] = Array.from(stemPositions.array as ArrayLike<number>)
  const faces = THREE.ShapeUtils.triangulateShape(
    localPoints.map((point) => new THREE.Vector2(point.x, point.z)),
    [],
  )
  for (const [ia, ib, ic] of faces) {
    const a = localPoints[ia!]!
    const b = localPoints[ib!]!
    const c = localPoints[ic!]!
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
    const [second, third] = cross >= 0 ? [c, b] : [b, c]
    positions.push(a.x, topY, a.z, second.x, topY, second.z, third.x, topY, third.z)
  }
  stem.dispose()
  const solid = new THREE.BufferGeometry()
  solid.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  solid.computeVertexNormals()
  ensureRenderableGeometryAttributes(solid)
  computeGeometryBoundsTree(solid)

  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const point of localPoints) {
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  const depth = maxZ - minZ + 0.2
  const centerZ = (minZ + maxZ) / 2

  let result = new Brush(solid)
  result.updateMatrixWorld()
  for (const opening of openings) {
    const height = opening.bottom - opening.top
    if (height <= 1e-6) continue
    const box = new THREE.BoxGeometry(opening.width, height, depth)
    box.translate(opening.u, -(opening.top + opening.bottom) / 2, centerZ)
    const cutter = new Brush(box)
    prepareBrushForCSG(cutter)
    const next = csgEvaluator.evaluate(result, cutter, SUBTRACTION)
    csgGeometry(cutter).dispose()
    csgGeometry(result).dispose()
    result = next
  }
  // the other skirts and the body merge non-indexed
  const cut = csgGeometry(result)
  const geometry = cut.index ? cut.toNonIndexed() : cut
  if (geometry !== cut) cut.dispose()
  geometry.clearGroups()
  return geometry
}

function mergeWallTerrainFill(
  body: THREE.BufferGeometry,
  fills: (THREE.BufferGeometry | null)[],
  wall: WallNode,
  boundaryEdges: TaggedWallBoundaryEdge[],
  finish: WallFinishContext,
): THREE.BufferGeometry {
  const present = fills.filter((fill): fill is THREE.BufferGeometry => fill !== null)
  if (present.length === 0) return body

  const bodyGeometry = body.index ? body.toNonIndexed() : body
  if (bodyGeometry !== body) body.dispose()
  // The fill is part of each face below the base: it splits at the same finish bounds.
  const planes = getWallFinishSplitPlanes(finish)
  const splitFills = present.map((fill) => splitGeometryAtPlanes(fill, planes.y, planes.x))
  ensureRenderableGeometryAttributes(bodyGeometry)
  for (const fill of splitFills) ensureRenderableGeometryAttributes(fill)
  const merged = mergeGeometries([bodyGeometry, ...splitFills], false)
  if (!merged) {
    for (const fill of splitFills) fill.dispose()
    return bodyGeometry
  }

  bodyGeometry.dispose()
  for (const fill of splitFills) fill.dispose()
  merged.computeVertexNormals()
  assignWallMaterialGroups(merged, wall, boundaryEdges, finish)
  ensureRenderableGeometryAttributes(merged)
  return merged
}

/** Wall-local x of a support-segment parameter (curve parameter on arcs). */
function wallStationX(wall: WallNode, t: number, length: number): number {
  if (!isCurvedWall(wall)) return t * length
  const point = getWallCurveFrameAt(wall, t).point
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  return ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) / length
}

function buildWallFinishContext(
  wall: WallNode,
  layout: WallFinishLayout,
  faceBase:
    | { a: readonly WallSlabSupportSegment[]; b: readonly WallSlabSupportSegment[] }
    | undefined,
  slabElevation: number,
): WallFinishContext {
  const refs = [...layout.refs]
  let foundation: WallFinishContext['foundation'] = null
  if (wall.underpinning) {
    const ref = wall.slots?.foundation ?? WALL_SURFACE_SLOT_DEFAULTS.foundation
    if (!refs.includes(ref)) refs.push(ref)
    foundation = { index: 3 + refs.indexOf(ref), top: -wall.underpinning.rim }
  }
  if (!faceBase || layout.plain) return { layout, faceBase: null, refs, foundation }
  const runs = (segments: readonly WallSlabSupportSegment[]) =>
    segments
      .map((segment) => ({
        start: wallStationX(wall, segment.start, layout.length),
        end: wallStationX(wall, segment.end, layout.length),
        y: segment.elevation - slabElevation,
      }))
      .sort((left, right) => left.start - right.start)
  return { layout, faceBase: { a: runs(faceBase.a), b: runs(faceBase.b) }, refs, foundation }
}

export function generateExtrudedWall(
  wallNode: WallNode,
  childrenNodes: AnyNode[],
  miterData: WallMiterData,
  slabElevation = 0,
  baseElevation = slabElevation,
  baseSegments: readonly WallSlabSupportSegment[] = [
    { start: 0, end: 1, elevation: baseElevation },
  ],
  storeyHeight = DEFAULT_LEVEL_HEIGHT,
  terrainBottomAt?: WallTerrainBottomSampler,
  faceBase?: { a: readonly WallSlabSupportSegment[]; b: readonly WallSlabSupportSegment[] },
  finishLayout: WallFinishLayout = buildWallFinishLayout(wallNode, []),
  sceneNodes: Readonly<Record<string, AnyNode>> = useScene.getState().nodes,
): THREE.BufferGeometry {
  const wallStart: Point2D = { x: wallNode.start[0], y: wallNode.start[1] }
  const wallEnd: Point2D = { x: wallNode.end[0], y: wallNode.end[1] }
  const topElevation = resolveWallTop(wallNode, storeyHeight, slabElevation)
  const faceDatum = faceBase
  if (faceBase)
    faceBase = {
      a: resolveWallFaceBottom(faceBase.a, baseSegments, slabElevation),
      b: resolveWallFaceBottom(faceBase.b, baseSegments, slabElevation),
    }
  const faceSegments = faceBase ? [...faceBase.a, ...faceBase.b] : []
  const sameBase =
    faceBase &&
    [faceBase.a, faceBase.b].every(
      (segments) => JSON.stringify(segments) === JSON.stringify(baseSegments),
    )
  const useFaceBase = faceBase && !sameBase
  const effectiveBaseElevation = useFaceBase
    ? Math.min(
        ...faceSegments.flatMap((segment) => [
          segment.elevation,
          segment.endElevation ?? segment.elevation,
        ]),
        slabElevation,
      )
    : Math.min(baseElevation, slabElevation)
  const localBottom = effectiveBaseElevation - slabElevation
  const height = topElevation - effectiveBaseElevation
  // A slab at or above the storey plane leaves a plane-bound wall with no
  // body — bail before ExtrudeGeometry sees a non-positive depth.
  if (height <= 1e-9) {
    return new THREE.BufferGeometry()
  }

  const thickness = getWallThickness(wallNode)

  // Wall direction and normal (exactly like demo)
  const v = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y }
  const L = Math.sqrt(v.x * v.x + v.y * v.y)
  if (L < 1e-9) {
    return new THREE.BufferGeometry()
  }
  const boundaryPoints = getWallMiterBoundaryPoints(wallNode, miterData)
  const polyPoints = isCurvedWall(wallNode)
    ? getWallSurfacePolygon(
        wallNode,
        24,
        insetCurvedWallBoundaryPointsFor3D(wallNode, boundaryPoints, miterData) ?? undefined,
      )
    : getWallPlanFootprint(wallNode, miterData)
  if (polyPoints.length < 3) {
    return new THREE.BufferGeometry()
  }

  // Transform world coordinates to wall-local coordinates
  // Wall-local: x along wall, z perpendicular (thickness direction)
  const wallAngle = Math.atan2(v.y, v.x)
  const cosA = Math.cos(-wallAngle)
  const sinA = Math.sin(-wallAngle)

  const worldToLocal = (worldPt: Point2D): { x: number; z: number } => {
    const dx = worldPt.x - wallStart.x
    const dy = worldPt.y - wallStart.y
    return {
      x: dx * cosA - dy * sinA,
      z: dx * sinA + dy * cosA,
    }
  }

  // Convert polygon to local coordinates
  const localPoints = polyPoints.map(worldToLocal)
  const boundaryEdges = buildTaggedWallBoundaryEdges(wallNode, localPoints, miterData)
  const finish = buildWallFinishContext(wallNode, finishLayout, faceDatum, slabElevation)
  const finishPlanes = getWallFinishSplitPlanes(finish)
  // An underpinned wall's stem skirt reaches the terrain itself; the plain
  // terrain fill is for a wall with no underpinning.
  const underpinningFills = buildWallUnderpinningGeometry(
    polyPoints,
    worldToLocal,
    slabElevation,
    wallNode,
    terrainBottomAt,
    isCurvedWall(wallNode),
  )
  const terrainFill =
    terrainBottomAt && !wallNode.underpinning
      ? buildWallTerrainFillGeometry(polyPoints, worldToLocal, slabElevation, terrainBottomAt)
      : null
  const belowBaseFills = [terrainFill, ...underpinningFills]

  // Build THREE.js shape
  // Shape uses (x, y) where we map: shape.x = local.x, shape.y = -local.z
  // The negation is needed because after rotateX(-PI/2), shape.y becomes -geometry.z
  const footprint = new THREE.Shape()
  footprint.moveTo(localPoints[0]!.x, -localPoints[0]!.z)
  for (let i = 1; i < localPoints.length; i++) {
    footprint.lineTo(localPoints[i]!.x, -localPoints[i]!.z)
  }
  footprint.closePath()

  // Extrude along Z by height
  const geometry = new THREE.ExtrudeGeometry(footprint, {
    depth: height,
    bevelEnabled: false,
  })

  // Rotate so extrusion direction (Z) becomes height direction (Y)
  geometry.rotateX(-Math.PI / 2)
  if (Math.abs(localBottom) > 1e-9) geometry.translate(0, localBottom, 0)
  geometry.computeVertexNormals()
  assignWallMaterialGroups(geometry, wallNode, boundaryEdges, finish)
  ensureRenderableGeometryAttributes(geometry)

  // Start with the lowest required wall prism, then remove the volume below
  // each higher-supported run. This keeps the existing mitered footprint and
  // opening CSG while giving one wall a stepped longitudinal base.
  const baseProfileCutouts: Brush[] = []
  const profiles =
    useFaceBase && faceBase
      ? [
          ...faceBase.a.map((segment) => ({ segment, face: 'a' as const })),
          ...faceBase.b.map((segment) => ({ segment, face: 'b' as const })),
        ]
      : baseSegments.map((segment) => ({ segment, face: undefined }))
  for (const { segment, face } of profiles) {
    const segmentElevation = face
      ? Math.min(
          Math.max(segment.elevation, segment.endElevation ?? segment.elevation),
          topElevation,
        )
      : Math.min(segment.elevation, slabElevation)
    const cutHeight = segmentElevation - effectiveBaseElevation
    if (cutHeight <= 1e-6 || segment.end - segment.start <= 1e-7) continue

    const segmentStart = THREE.MathUtils.clamp(segment.start, 0, 1)
    const segmentEnd = THREE.MathUtils.clamp(segment.end, 0, 1)
    const cutHalfWidth = Math.max(thickness * 2, 0.2)
    const centerOffset = getWallBodyCenterOffset(wallNode)
    const leftOffset = face === 'b' ? centerOffset : cutHalfWidth
    const rightOffset = face === 'a' ? centerOffset : -cutHalfWidth
    const worldCutoutPoints: Point2D[] = []

    if (isCurvedWall(wallNode)) {
      const sampleCount = Math.max(2, Math.ceil((segmentEnd - segmentStart) * 24))
      const left: Point2D[] = []
      const right: Point2D[] = []
      for (let index = 0; index <= sampleCount; index++) {
        const t = segmentStart + ((segmentEnd - segmentStart) * index) / sampleCount
        const frame = getWallCurveFrameAt(wallNode, t)
        const endpointExtension =
          index === 0 && segmentStart <= 1e-7
            ? -cutHalfWidth
            : index === sampleCount && segmentEnd >= 1 - 1e-7
              ? cutHalfWidth
              : 0
        const center = {
          x: frame.point.x + frame.tangent.x * endpointExtension,
          y: frame.point.y + frame.tangent.y * endpointExtension,
        }
        left.push({
          x: center.x + frame.normal.x * leftOffset,
          y: center.y + frame.normal.y * leftOffset,
        })
        right.push({
          x: center.x + frame.normal.x * rightOffset,
          y: center.y + frame.normal.y * rightOffset,
        })
      }
      worldCutoutPoints.push(...left, ...right.reverse())
    } else {
      const tangentX = v.x / L
      const tangentY = v.y / L
      const normalX = -tangentY
      const normalY = tangentX
      const startExtension = segmentStart <= 1e-7 ? cutHalfWidth : 0
      const endExtension = segmentEnd >= 1 - 1e-7 ? cutHalfWidth : 0
      const startPoint = {
        x: wallStart.x + tangentX * (segmentStart * L - startExtension),
        y: wallStart.y + tangentY * (segmentStart * L - startExtension),
      }
      const endPoint = {
        x: wallStart.x + tangentX * (segmentEnd * L + endExtension),
        y: wallStart.y + tangentY * (segmentEnd * L + endExtension),
      }
      worldCutoutPoints.push(
        {
          x: startPoint.x + normalX * leftOffset,
          y: startPoint.y + normalY * leftOffset,
        },
        { x: endPoint.x + normalX * leftOffset, y: endPoint.y + normalY * leftOffset },
        { x: endPoint.x + normalX * rightOffset, y: endPoint.y + normalY * rightOffset },
        {
          x: startPoint.x + normalX * rightOffset,
          y: startPoint.y + normalY * rightOffset,
        },
      )
    }

    const localCutoutPoints = worldCutoutPoints.map(worldToLocal)
    if (localCutoutPoints.length < 3) continue
    const cutoutShape = new THREE.Shape()
    cutoutShape.moveTo(localCutoutPoints[0]!.x, -localCutoutPoints[0]!.z)
    for (let index = 1; index < localCutoutPoints.length; index++) {
      cutoutShape.lineTo(localCutoutPoints[index]!.x, -localCutoutPoints[index]!.z)
    }
    cutoutShape.closePath()

    const slopeExtension =
      segment.endElevation === undefined
        ? 0
        : (Math.abs(segment.endElevation - segment.elevation) * cutHalfWidth) /
          ((segmentEnd - segmentStart) * L)
    const cutoutBottom = localBottom - 0.01 - slopeExtension
    const cutoutTop = segmentElevation - slabElevation
    const cutoutGeometry = new THREE.ExtrudeGeometry(cutoutShape, {
      depth: cutoutTop - cutoutBottom,
      bevelEnabled: false,
    })
    cutoutGeometry.rotateX(-Math.PI / 2)
    cutoutGeometry.translate(0, cutoutBottom, 0)
    if (segment.endElevation !== undefined) {
      const from = wallStationX(wallNode, segmentStart, L)
      const to = wallStationX(wallNode, segmentEnd, L)
      const positions = cutoutGeometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(positions.getY(i) - cutoutTop) > 1e-5) continue
        const t = (positions.getX(i) - from) / (to - from)
        positions.setY(
          i,
          Math.min(
            topElevation,
            segment.elevation + (segment.endElevation - segment.elevation) * t,
          ) - slabElevation,
        )
      }
      cutoutGeometry.computeVertexNormals()
    }
    computeGeometryBoundsTree(cutoutGeometry)
    baseProfileCutouts.push(new Brush(cutoutGeometry))
  }

  const cutoutBrushes = [
    ...baseProfileCutouts,
    ...collectCutoutBrushes(
      wallNode,
      childrenNodes,
      thickness,
      faceDatum,
      slabElevation,
      sceneNodes,
      baseSegments,
    ),
  ]
  if (cutoutBrushes.length === 0) {
    const splitGeometry = splitGeometryAtPlanes(geometry, finishPlanes.y, finishPlanes.x)
    splitGeometry.computeVertexNormals()
    assignWallMaterialGroups(splitGeometry, wallNode, boundaryEdges, finish)
    ensureRenderableGeometryAttributes(splitGeometry)
    return withWallFinishData(
      mergeWallTerrainFill(splitGeometry, belowBaseFills, wallNode, boundaryEdges, finish),
      finish,
    )
  }

  // Create wall brush from geometry
  // Pre-compute BVH with new API to avoid deprecation warning
  ensureRenderableGeometryAttributes(geometry)
  computeGeometryBoundsTree(geometry)

  const wallBrush = new Brush(geometry)
  wallBrush.updateMatrixWorld()

  let mergedCutter: Brush | null = null
  let resultBrush = wallBrush
  try {
    const properties: Array<[string, string]> = []
    const merged = timeSpan(
      'wall-csg-union',
      () => {
        const cutouts = mergeWallCutoutBrushes(cutoutBrushes)
        properties.push(['droppedCutouts', String(cutouts.droppedCount)])
        return cutouts
      },
      { properties },
    )
    mergedCutter = merged.cutter
    timeSpan('wall-csg', () => {
      if (mergedCutter) {
        resultBrush = csgEvaluator.evaluate(resultBrush, mergedCutter, SUBTRACTION)
      }
      for (const cutter of merged.fallbackBrushes) {
        const next = csgEvaluator.evaluate(resultBrush, cutter, SUBTRACTION)
        if (resultBrush !== wallBrush) csgGeometry(resultBrush).dispose()
        resultBrush = next
      }
    })
  } catch (error) {
    if (resultBrush !== wallBrush) csgGeometry(resultBrush).dispose()
    throw error
  } finally {
    csgGeometry(wallBrush).dispose()
    if (mergedCutter) csgGeometry(mergedCutter).dispose()
    for (const brush of cutoutBrushes) csgGeometry(brush).dispose()
  }

  const resultGeometry = csgGeometry(resultBrush)
  const splitResultGeometry = splitGeometryAtPlanes(resultGeometry, finishPlanes.y, finishPlanes.x)
  splitResultGeometry.computeVertexNormals()
  assignWallMaterialGroups(splitResultGeometry, wallNode, boundaryEdges, finish)
  ensureRenderableGeometryAttributes(splitResultGeometry)

  return withWallFinishData(
    mergeWallTerrainFill(splitResultGeometry, belowBaseFills, wallNode, boundaryEdges, finish),
    finish,
  )
}

function withWallFinishData(
  geometry: THREE.BufferGeometry,
  finish: WallFinishContext,
): THREE.BufferGeometry {
  if (!finish.layout.plain || finish.foundation) {
    geometry.userData.wallFinish = {
      refs: finish.refs,
      faceBase: finish.faceBase,
    } satisfies WallFinishGeometryData
  }
  return geometry
}

/**
 * Collects opening and item cutout brushes for CSG subtraction. Door/window
 * cuts come directly from node geometry; item proxy meshes are transformed
 * into wall-local boxes that pass through the wall.
 */
/**
 * A CSG brush from an authored object's `cutout` mesh: the mesh in wall-local
 * space, its depth stretched to twice the wall's thickness about the wall's
 * body centre so it overshoots both faces. Null when the mesh has no depth to
 * stretch (a flat cutter), so the caller falls back to its bounding box.
 */
function authoredCutoutBrush(
  cutoutMesh: THREE.Mesh,
  wallMatrixInverse: THREE.Matrix4,
  wallThickness: number,
  wallNode: WallNode,
  inverseShear: THREE.Matrix4 | null,
): Brush | null {
  const geometry = cutoutMesh.geometry.clone()
  geometry.applyMatrix4(
    new THREE.Matrix4().multiplyMatrices(wallMatrixInverse, cutoutMesh.matrixWorld),
  )
  if (inverseShear) geometry.applyMatrix4(inverseShear)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const depth = box.max.z - box.min.z
  if (!(depth > 1e-4)) {
    geometry.dispose()
    return null
  }
  const centre = getWallBodyCenterOffset(wallNode)
  const meshCentre = (box.min.z + box.max.z) / 2
  const scale = (wallThickness * 2) / depth
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    positions.setZ(i, centre + (positions.getZ(i) - meshCentre) * scale)
  }
  positions.needsUpdate = true
  // The evaluator needs the attributes every brush carries.
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(positions.count * 2), 2))
  }
  geometry.computeVertexNormals()
  computeGeometryBoundsTree(geometry)
  return new Brush(geometry)
}

function collectCutoutBrushes(
  wallNode: WallNode,
  childrenNodes: AnyNode[],
  wallThickness: number,
  faceBase?: { a: readonly WallSlabSupportSegment[]; b: readonly WallSlabSupportSegment[] },
  elevation = 0,
  sceneNodes: Readonly<Record<string, AnyNode>> = useScene.getState().nodes,
  baseSegments: readonly WallSlabSupportSegment[] = [{ start: 0, end: 1, elevation }],
): Brush[] {
  const brushes: Brush[] = []
  const wallMesh = sceneRegistry.nodes.get(wallNode.id) as THREE.Mesh
  if (!wallMesh) return brushes

  // Get wall's world matrix inverse to transform cutouts to wall-local space
  wallMesh.updateMatrixWorld()
  const wallMatrixInverse = wallMesh.matrixWorld.clone().invert()

  const inverseShear = wallNode.tilt
    ? new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, -Math.tan(wallNode.tilt))
    : null

  for (const child of childrenNodes) {
    if (child.type !== 'item' && child.type !== 'window' && child.type !== 'door') continue

    // A window or door built from a script cuts its `cutout` mesh like an
    // authored item (below); without one, or until it loads, its outline.
    const scriptedCutout =
      child.type !== 'item' &&
      child.source &&
      sceneRegistry.nodes.get(child.id)?.getObjectByName('cutout')
    if ((child.type === 'door' || child.type === 'window') && !scriptedCutout) {
      const nodes = {
        ...sceneNodes,
        [wallNode.id]: wallNode,
        ...Object.fromEntries(childrenNodes.map((node) => [node.id, node])),
      }
      const datum = faceBase ?? {
        a: [{ start: 0, end: 1, elevation }],
        b: [{ start: 0, end: 1, elevation }],
      }
      const support: WallSlabSupport = {
        elevation,
        electedSlabId: null,
        baseElevation: elevation,
        baseSegments: [...baseSegments],
        faceDatum: { a: [...datum.a], b: [...datum.b] },
        faceBottom: {
          a: resolveWallFaceBottom(datum.a, baseSegments, elevation),
          b: resolveWallFaceBottom(datum.b, baseSegments, elevation),
        },
      }
      const cut = getOpeningWallCut(wallNode, child, nodes, support)
      // The cutter must overshoot the faces it cuts through; `cut.aperture` is
      // clipped to the wall's own footprint (the doorway floor), so extruding it
      // would leave coplanar faces and CSG would drop the cut.
      if (!isCurvedWall(wallNode)) {
        brushes.push(
          createOpeningCutoutBrush(
            {
              ...child,
              position: [
                child.position[0],
                child.position[1] + cut.datum - elevation,
                child.position[2],
              ],
            },
            wallThickness,
            getWallBodyCenterOffset(wallNode),
            cut.bottom - elevation,
          ),
        )
        continue
      }
      if (cut.band.length < 3) continue
      const angle = Math.atan2(
        wallNode.end[1] - wallNode.start[1],
        wallNode.end[0] - wallNode.start[0],
      )
      const points = cut.band.map(([x, z]) => {
        const dx = x - wallNode.start[0],
          dz = z - wallNode.start[1]
        return new THREE.Vector2(
          dx * Math.cos(angle) + dz * Math.sin(angle),
          dx * Math.sin(angle) - dz * Math.cos(angle),
        )
      })
      const padding = getOpeningCutoutBottomPadding(child, cut.bottom - elevation)
      const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), {
        depth: cut.top - cut.bottom + padding,
        bevelEnabled: false,
      })
      geometry.rotateX(-Math.PI / 2)
      geometry.translate(0, cut.bottom - elevation - padding, 0)
      computeGeometryBoundsTree(geometry)
      const bandBrush = new Brush(geometry)
      if (child.openingShape !== 'arch' && child.openingShape !== 'rounded') {
        brushes.push(bandBrush)
        continue
      }
      const shaped = createOpeningCutoutBrush(
        {
          ...child,
          position: [
            child.position[0],
            child.position[1] + cut.datum - elevation,
            child.position[2],
          ],
        },
        wallThickness,
        getWallBodyCenterOffset(wallNode),
        cut.bottom - elevation,
      )
      const frame = getWallCurveFrameAt(wallNode, child.position[0] / getWallCurveLength(wallNode))
      const offset = getWallBodyCenterOffset(wallNode)
      const dx = frame.point.x + frame.normal.x * offset - wallNode.start[0],
        dz = frame.point.y + frame.normal.y * offset - wallNode.start[1]
      csgGeometry(shaped).translate(-child.position[0], 0, -offset)
      csgGeometry(shaped).rotateY(angle - Math.atan2(frame.tangent.y, frame.tangent.x))
      csgGeometry(shaped).translate(
        dx * Math.cos(angle) + dz * Math.sin(angle),
        0,
        -dx * Math.sin(angle) + dz * Math.cos(angle),
      )
      prepareBrushForCSG(bandBrush)
      prepareBrushForCSG(shaped)
      bandBrush.updateMatrixWorld()
      shaped.updateMatrixWorld()
      brushes.push(csgEvaluator.evaluate(bandBrush, shaped, INTERSECTION))
      geometry.dispose()
      csgGeometry(shaped).dispose()
      continue
    }

    const childMesh = sceneRegistry.nodes.get(child.id)
    if (!childMesh) continue

    const cutoutMesh = childMesh.getObjectByName('cutout') as THREE.Mesh
    if (!cutoutMesh) continue

    // Get the cutout's bounding box in world space
    cutoutMesh.updateMatrixWorld()
    const positions = cutoutMesh.geometry?.attributes?.position
    if (!positions) continue

    // Calculate bounds in wall-local space
    const v3 = new THREE.Vector3()
    let minX = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY

    for (let i = 0; i < positions.count; i++) {
      v3.fromBufferAttribute(positions, i)
      v3.applyMatrix4(cutoutMesh.matrixWorld)
      v3.applyMatrix4(wallMatrixInverse)
      if (inverseShear) v3.applyMatrix4(inverseShear)

      minX = Math.min(minX, v3.x)
      maxX = Math.max(maxX, v3.x)
      minY = Math.min(minY, v3.y)
      maxY = Math.max(maxY, v3.y)
    }

    if (!Number.isFinite(minX)) continue

    // An authored object's cutout keeps its shape (an arch, a circle): its own
    // geometry in wall space, stretched across the wall so it cuts both faces.
    if (child.source) {
      const shaped = authoredCutoutBrush(
        cutoutMesh,
        wallMatrixInverse,
        wallThickness,
        wallNode,
        inverseShear,
      )
      if (shaped) {
        brushes.push(shaped)
        continue
      }
    }

    // Create a box geometry that extends through the wall thickness
    const width = maxX - minX
    const height = maxY - minY
    const depth = wallThickness * 2 // Extend beyond wall to ensure clean cut

    const boxGeo = new THREE.BoxGeometry(width, height, depth)
    // Position box at the center of the cutout
    boxGeo.translate(minX + width / 2, minY + height / 2, getWallBodyCenterOffset(wallNode))

    // Pre-compute BVH with new API to avoid deprecation warning
    computeGeometryBoundsTree(boxGeo)

    const brush = new Brush(boxGeo)
    brushes.push(brush)
  }

  return brushes
}

function createOpeningCutoutBrush(
  opening: DoorNode | WindowNode,
  wallThickness: number,
  centerOffset: number,
  cutBottom?: number,
): Brush {
  const halfWidth = opening.width / 2
  const bottom = cutBottom ?? opening.position[1] - opening.height / 2
  const bottomPadding = getOpeningCutoutBottomPadding(opening, bottom)
  const geometry = buildOpeningCutoutGeometry(
    opening,
    {
      left: opening.position[0] - halfWidth,
      right: opening.position[0] + halfWidth,
      bottom: bottom - bottomPadding,
      top: opening.position[1] + opening.height / 2,
    },
    wallThickness * 2,
    wallThickness,
  )
  if (centerOffset !== 0) geometry.translate(0, 0, centerOffset)
  computeGeometryBoundsTree(geometry)

  return new Brush(geometry)
}
