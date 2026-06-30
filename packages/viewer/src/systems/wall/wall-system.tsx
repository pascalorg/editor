import {
  type AnyNode,
  type AnyNodeId,
  calculateLevelMiters,
  DEFAULT_WALL_HEIGHT,
  type DoorNode,
  getAdjacentWallIds,
  getEffectiveNode,
  getWallCurveFrameAt,
  getWallMiterBoundaryPoints,
  getWallPlanFootprint,
  getWallSurfacePolygon,
  getWallThickness,
  isCurvedWall,
  type Point2D,
  pointToKey,
  resolveLevelId,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  type WallMiterData,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { ensureRenderableGeometryAttributes, prepareBrushForCSG } from '../../lib/csg-utils'
import { buildOpeningCutoutGeometry } from './opening-cutout-geometry'

// Reusable CSG evaluator for better performance
const csgEvaluator = new Evaluator()
csgEvaluator.attributes = ['position', 'normal', 'uv', 'uv2']
const CURVED_WALL_3D_ENDPOINT_INSET = 0.0015
const WALL_FACE_NORMAL_Y_EPSILON = 0.6
const WALL_FACE_EDGE_DISTANCE_EPSILON = 0.003

function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

function csgGeometry(brush: Brush): THREE.BufferGeometry {
  return brush.geometry as unknown as THREE.BufferGeometry
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

function getWallFaceMaterialIndex(
  wall: Pick<WallNode, 'frontSide' | 'backSide'>,
  face: 'front' | 'back',
): 0 | 1 | 2 {
  const semantic = face === 'front' ? wall.frontSide : wall.backSide
  const fallback = face === 'front' ? 1 : 2

  if (semantic === 'interior') return 1
  if (semantic === 'exterior') return 2
  return fallback
}

function assignWallMaterialGroups(
  geometry: THREE.BufferGeometry,
  wall: WallNode,
  boundaryEdges: TaggedWallBoundaryEdge[],
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

    triangleMaterials[triangleIndex] = getWallFaceMaterialIndex(wall, nearestTag)
  }

  geometry.clearGroups()

  let currentMaterial = triangleMaterials[0] ?? 0
  let groupStart = 0

  for (let triangleIndex = 1; triangleIndex < triangleCount; triangleIndex += 1) {
    const materialIndex = triangleMaterials[triangleIndex] ?? 0
    if (materialIndex === currentMaterial) continue

    geometry.addGroup(groupStart * 3, (triangleIndex - groupStart) * 3, currentMaterial)
    groupStart = triangleIndex
    currentMaterial = materialIndex
  }

  geometry.addGroup(groupStart * 3, (triangleCount - groupStart) * 3, currentMaterial)
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
let lastWallDirtyAtMs = 0
const pendingAdjacentByLevel = new Map<string, Set<string>>()

function getPendingAdjacentCount() {
  let count = 0
  for (const ids of pendingAdjacentByLevel.values()) {
    count += ids.size
  }
  return count
}

export const WallSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  // Subscribe so override-only changes (no scene write) still re-run
  // this component, which lets the gate below pick up the latest
  // `dirtyNodes` set from the same render pass that received the
  // override-publishing `markDirty` call. Without this, very fast
  // drags could land an override and a markDirty in the same React
  // tick and the next `useFrame` would still see the stale closure.
  useLiveNodeOverrides((s) => s.overrides)

  useFrame(() => {
    const hasDirty = dirtyNodes.size > 0
    const hasPending = pendingAdjacentByLevel.size > 0
    if (!hasDirty && !hasPending) return

    const nodes = useScene.getState().nodes
    const now = performance.now()

    // Collect dirty walls and their levels
    const dirtyWallsByLevel = new Map<string, Set<string>>()
    let dirtyWallCount = 0

    useFrameNb += 1
    if (hasDirty) {
      dirtyNodes.forEach((id) => {
        const node = nodes[id]
        if (node?.type !== 'wall') return

        const levelId = node.parentId
        if (!levelId) return

        if (!dirtyWallsByLevel.has(levelId)) {
          dirtyWallsByLevel.set(levelId, new Set())
        }
        dirtyWallsByLevel.get(levelId)?.add(id)
        dirtyWallCount += 1
      })
    }

    const hasDirtyWalls = dirtyWallsByLevel.size > 0
    if (hasDirtyWalls) {
      lastWallDirtyAtMs = now
    }

    const useProgressiveWallRebuilds = dirtyWallCount > WALL_PROGRESSIVE_DIRTY_THRESHOLD
    let rebuiltWallsThisFrame = 0
    const rebuildFrameStartedAt = now

    // Process each level that has dirty walls
    for (const [levelId, dirtyWallIds] of dirtyWallsByLevel) {
      if (useProgressiveWallRebuilds && rebuiltWallsThisFrame >= MAX_WALL_REBUILDS_PER_FRAME) {
        break
      }

      const levelWalls = getLevelWalls(levelId)
      const miterData = calculateLevelMiters(levelWalls)
      const rebuiltWallIds = new Set<string>()

      // Update dirty walls — always, no throttling. The dragged wall must
      // follow the cursor with full fidelity (cutouts and all). Large imports
      // enter the progressive path so initial load can't lock the tab.
      for (const wallId of dirtyWallIds) {
        if (useProgressiveWallRebuilds) {
          if (rebuiltWallsThisFrame >= MAX_WALL_REBUILDS_PER_FRAME) {
            break
          }
          if (
            rebuiltWallsThisFrame > 0 &&
            performance.now() - rebuildFrameStartedAt >= WALL_PROGRESSIVE_TIME_BUDGET_MS
          ) {
            break
          }
        }

        const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
        if (mesh) {
          updateWallGeometry(wallId, miterData)
          clearDirty(wallId as AnyNodeId)
          rebuiltWallIds.add(wallId)
          rebuiltWallsThisFrame += 1
        }
        // If mesh not found, keep it dirty for next frame
      }

      if (rebuiltWallIds.size === 0) {
        continue
      }

      // Adjacent walls sharing junctions — *defer* during active drag
      // (dirty arrived this frame), flush on the trailing edge.
      const adjacentWallIds = getAdjacentWallIds(levelWalls, rebuiltWallIds)
      let pending = pendingAdjacentByLevel.get(levelId)
      if (!pending) {
        pending = new Set()
        pendingAdjacentByLevel.set(levelId, pending)
      }
      for (const wallId of adjacentWallIds) {
        if (!dirtyWallIds.has(wallId)) {
          pending.add(wallId)
        }
      }
    }

    // Trailing-edge flush: if no new dirty marks for DRAG_FLUSH_MS, the
    // drag has ended — rebuild the queued neighbors so corners snap into
    // their correct miter joins.
    const quiet = !hasDirtyWalls && now - lastWallDirtyAtMs >= DRAG_FLUSH_MS
    if (quiet && pendingAdjacentByLevel.size > 0) {
      const pendingCount = getPendingAdjacentCount()
      const useProgressiveAdjacentRebuilds = pendingCount > WALL_PROGRESSIVE_DIRTY_THRESHOLD
      let rebuiltAdjacentThisFrame = 0
      const adjacentFrameStartedAt = performance.now()

      for (const [levelId, pendingIds] of pendingAdjacentByLevel) {
        if (pendingIds.size === 0) continue
        const levelWalls = getLevelWalls(levelId)
        const miterData = calculateLevelMiters(levelWalls)
        for (const wallId of Array.from(pendingIds)) {
          if (useProgressiveAdjacentRebuilds) {
            if (rebuiltAdjacentThisFrame >= MAX_WALL_REBUILDS_PER_FRAME) {
              break
            }
            if (
              rebuiltAdjacentThisFrame > 0 &&
              performance.now() - adjacentFrameStartedAt >= WALL_PROGRESSIVE_TIME_BUDGET_MS
            ) {
              break
            }
          }

          const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
          if (mesh) updateWallGeometry(wallId, miterData)
          pendingIds.delete(wallId)
          rebuiltAdjacentThisFrame += 1
        }

        if (pendingIds.size === 0) {
          pendingAdjacentByLevel.delete(levelId)
        }

        if (
          useProgressiveAdjacentRebuilds &&
          rebuiltAdjacentThisFrame >= MAX_WALL_REBUILDS_PER_FRAME
        ) {
          break
        }
      }
    }
  }, 4)

  return null
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
function updateWallGeometry(wallId: string, miterData: WallMiterData) {
  const nodes = useScene.getState().nodes
  const sceneNode = nodes[wallId as WallNode['id']]
  if (sceneNode?.type !== 'wall') return
  const node = getEffectiveWall(sceneNode as WallNode)

  const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
  if (!mesh) return

  const levelId = resolveLevelId(node, nodes)
  const slabElevation = spatialGridManager.getSlabElevationForWall(
    levelId,
    node.start,
    node.end,
    node.curveOffset ?? 0,
    node.thickness,
  )

  const childrenIds = node.children || []
  // Merge live overrides into door / window children so cutouts track an
  // in-flight resize drag (door width arrow, window height arrow, etc.)
  // without waiting on the scene store. Non-cutout children pass through
  // unchanged.
  const childrenNodes = childrenIds
    .map((childId) => nodes[childId])
    .filter((n): n is AnyNode => n !== undefined)
    .map((child) => {
      if (child.type !== 'door' && child.type !== 'window') return child
      // `getEffectiveNode` folds in resize overrides (width/height arrows).
      // Position moves publish to `useLiveTransforms` instead, so fold that
      // in too — otherwise shaped openings (arch/rounded/`opening`), whose
      // cutout brush is rebuilt from `node.position`, lag the live move
      // (rectangular cutouts already track via the live mesh matrixWorld).
      const effective = getEffectiveNode(child)
      const live = useLiveTransforms.getState().get(child.id)
      if (!live?.position) return effective
      return { ...effective, position: live.position }
    })

  const builtGeo = generateExtrudedWall(node, childrenNodes, miterData, slabElevation)
  const wallAngle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  // World transform the render mesh will apply (position + Y-rotation below).
  // Reproduce it here so the UVs can be projected in WORLD space — see
  // `applyWorldPlanarWallUVs`.
  const wallWorldMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(node.start[0], slabElevation, node.start[1]),
    new THREE.Quaternion().setFromAxisAngle(WALL_UV_Y_AXIS, -wallAngle),
    WALL_UV_UNIT_SCALE,
  )
  const newGeo = applyWorldPlanarWallUVs(builtGeo, wallWorldMatrix)

  mesh.geometry.dispose()
  mesh.geometry = newGeo
  // Update collision mesh
  const collisionMesh = mesh.getObjectByName('collision-mesh') as THREE.Mesh
  if (collisionMesh) {
    const collisionGeo = generateExtrudedWall(node, [], miterData, slabElevation)
    collisionMesh.geometry.dispose()
    collisionMesh.geometry = collisionGeo
  }

  mesh.position.set(node.start[0], slabElevation, node.start[1])
  const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  mesh.rotation.y = -angle
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
  if (target !== geometry) geometry.dispose()

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
export function generateExtrudedWall(
  wallNode: WallNode,
  childrenNodes: AnyNode[],
  miterData: WallMiterData,
  slabElevation = 0,
): THREE.BufferGeometry {
  const wallStart: Point2D = { x: wallNode.start[0], y: wallNode.start[1] }
  const wallEnd: Point2D = { x: wallNode.end[0], y: wallNode.end[1] }
  // Positive slab: shift the whole wall up (full height preserved)
  // Negative slab: extend wall downward so top stays fixed at wallNode.height
  const wallHeight = wallNode.height ?? DEFAULT_WALL_HEIGHT
  const height = slabElevation > 0 ? wallHeight : wallHeight - slabElevation

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
  geometry.computeVertexNormals()
  assignWallMaterialGroups(geometry, wallNode, boundaryEdges)
  ensureRenderableGeometryAttributes(geometry)

  // Apply CSG subtraction for cutouts (doors/windows)
  const cutoutBrushes = collectCutoutBrushes(wallNode, childrenNodes, thickness)
  if (cutoutBrushes.length === 0) {
    return geometry
  }

  // Create wall brush from geometry
  // Pre-compute BVH with new API to avoid deprecation warning
  ensureRenderableGeometryAttributes(geometry)
  computeGeometryBoundsTree(geometry)

  const wallBrush = new Brush(geometry)
  wallBrush.updateMatrixWorld()

  // Subtract each cutout from the wall
  let resultBrush = wallBrush
  for (const cutoutBrush of cutoutBrushes) {
    prepareBrushForCSG(cutoutBrush)
    const newResult = csgEvaluator.evaluate(resultBrush, cutoutBrush, SUBTRACTION)
    prepareBrushForCSG(newResult)
    if (resultBrush !== wallBrush) {
      csgGeometry(resultBrush).dispose()
    }
    resultBrush = newResult
  }

  // Clean up
  csgGeometry(wallBrush).dispose()
  for (const brush of cutoutBrushes) {
    csgGeometry(brush).dispose()
  }

  const resultGeometry = csgGeometry(resultBrush)
  resultGeometry.computeVertexNormals()
  assignWallMaterialGroups(resultGeometry, wallNode, boundaryEdges)
  ensureRenderableGeometryAttributes(resultGeometry)

  return resultGeometry
}

/**
 * Collects cutout brushes from child items for CSG subtraction
 * The cutout mesh is a plane, so we extrude it into a box that goes through the wall
 */
function collectCutoutBrushes(
  wallNode: WallNode,
  childrenNodes: AnyNode[],
  wallThickness: number,
): Brush[] {
  const brushes: Brush[] = []
  const wallMesh = sceneRegistry.nodes.get(wallNode.id) as THREE.Mesh
  if (!wallMesh) return brushes

  // Get wall's world matrix inverse to transform cutouts to wall-local space
  wallMesh.updateMatrixWorld()
  const wallMatrixInverse = wallMesh.matrixWorld.clone().invert()

  for (const child of childrenNodes) {
    if (child.type !== 'item' && child.type !== 'window' && child.type !== 'door') continue

    if (
      (child.type === 'door' && child.openingKind === 'opening') ||
      (child.type === 'door' &&
        child.openingKind === 'door' &&
        (child.openingShape === 'arch' || child.openingShape === 'rounded')) ||
      (child.type === 'window' && child.openingKind === 'opening') ||
      (child.type === 'window' &&
        child.openingKind === 'window' &&
        (child.openingShape === 'arch' || child.openingShape === 'rounded'))
    ) {
      brushes.push(createShapedOpeningCutoutBrush(child, wallThickness))
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

      minX = Math.min(minX, v3.x)
      maxX = Math.max(maxX, v3.x)
      minY = Math.min(minY, v3.y)
      maxY = Math.max(maxY, v3.y)
    }

    if (!Number.isFinite(minX)) continue

    // Create a box geometry that extends through the wall thickness
    const width = maxX - minX
    const height = maxY - minY
    const depth = wallThickness * 2 // Extend beyond wall to ensure clean cut

    const boxGeo = new THREE.BoxGeometry(width, height, depth)
    // Position box at the center of the cutout
    boxGeo.translate(
      minX + width / 2,
      minY + height / 2,
      0, // Center on Z axis (wall thickness direction)
    )

    // Pre-compute BVH with new API to avoid deprecation warning
    computeGeometryBoundsTree(boxGeo)

    const brush = new Brush(boxGeo)
    brushes.push(brush)
  }

  return brushes
}

function createShapedOpeningCutoutBrush(
  opening: DoorNode | WindowNode,
  wallThickness: number,
): Brush {
  const halfWidth = opening.width / 2
  const geometry = buildOpeningCutoutGeometry(
    opening,
    {
      left: opening.position[0] - halfWidth,
      right: opening.position[0] + halfWidth,
      bottom: opening.position[1] - opening.height / 2,
      top: opening.position[1] + opening.height / 2,
    },
    wallThickness * 2,
    wallThickness,
  )
  computeGeometryBoundsTree(geometry)

  return new Brush(geometry)
}
