import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import {
  calculateLevelMiters,
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getAdjacentWallIds,
  DEFAULT_WALL_HEIGHT,
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
  useScene,
  type WallNode,
  type WallMiterData,
  type WindowNode,
} from '@pascal-app/core'

// Reusable CSG evaluator for better performance
const csgEvaluator = new Evaluator()
const CURVED_WALL_3D_ENDPOINT_INSET = 0.0015
const WALL_FACE_NORMAL_Y_EPSILON = 0.6
const WALL_FACE_EDGE_DISTANCE_EPSILON = 0.003

function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

type WallBoundaryEdgeTag = 'front' | 'back' | 'base'

type TaggedWallBoundaryEdge = {
  start: THREE.Vector2
  end: THREE.Vector2
  tag: WallBoundaryEdgeTag
}

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

function insetCurvedWallBoundaryPointsFor3D(
  wall: WallNode,
  boundaryPoints: ReturnType<typeof getWallMiterBoundaryPoints>,
  miterData: WallMiterData,
) {
  if (!boundaryPoints || !isCurvedWall(wall)) {
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
export const WallSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    // Collect dirty walls and their levels
    const dirtyWallsByLevel = new Map<string, Set<string>>()

    useFrameNb += 1
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'wall') return

      const levelId = node.parentId
      if (!levelId) return

      if (!dirtyWallsByLevel.has(levelId)) {
        dirtyWallsByLevel.set(levelId, new Set())
      }
      dirtyWallsByLevel.get(levelId)?.add(id)
    })

    // Process each level that has dirty walls
    for (const [levelId, dirtyWallIds] of dirtyWallsByLevel) {
      const levelWalls = getLevelWalls(levelId)
      const miterData = calculateLevelMiters(levelWalls)

      // Update dirty walls
      for (const wallId of dirtyWallIds) {
        const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
        if (mesh) {
          updateWallGeometry(wallId, miterData)
          clearDirty(wallId as AnyNodeId)
        }
        // If mesh not found, keep it dirty for next frame
      }

      // Update adjacent walls that share junctions
      const adjacentWallIds = getAdjacentWallIds(levelWalls, dirtyWallIds)
      for (const wallId of adjacentWallIds) {
        if (!dirtyWallIds.has(wallId)) {
          const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
          if (mesh) {
            updateWallGeometry(wallId, miterData)
          }
        }
      }
    }
  }, 4)

  return null
}

/**
 * Gets all walls that belong to a level
 */
function getLevelWalls(levelId: string): WallNode[] {
  const { nodes } = useScene.getState()
  const level = nodes[levelId as AnyNodeId]

  if (!level || level.type !== 'level') return []

  const walls: WallNode[] = []
  for (const childId of level.children) {
    const child = nodes[childId]
    if (child?.type === 'wall') {
      walls.push(child as WallNode)
    }
  }

  return walls
}

/**
 * Updates the geometry for a single wall
 */
function updateWallGeometry(wallId: string, miterData: WallMiterData) {
  const nodes = useScene.getState().nodes
  const node = nodes[wallId as WallNode['id']]
  if (!node || node.type !== 'wall') return

  const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
  if (!mesh) return

  const levelId = resolveLevelId(node, nodes)
  const slabElevation = spatialGridManager.getSlabElevationForWall(levelId, node.start, node.end)

  const childrenIds = node.children || []
  const childrenNodes = childrenIds
    .map((childId) => nodes[childId])
    .filter((n): n is AnyNode => n !== undefined)

  const newGeo = generateExtrudedWall(node, childrenNodes, miterData, slabElevation)

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
) {
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
  ensureUv2Attribute(geometry)

  // Apply CSG subtraction for cutouts (doors/windows)
  const cutoutBrushes = collectCutoutBrushes(wallNode, childrenNodes, thickness)
  if (cutoutBrushes.length === 0) {
    return geometry
  }

  // Create wall brush from geometry
  // Pre-compute BVH with new API to avoid deprecation warning
  computeGeometryBoundsTree(geometry)

  const wallBrush = new Brush(geometry)
  wallBrush.updateMatrixWorld()

  // Subtract each cutout from the wall
  let resultBrush = wallBrush
  for (const cutoutBrush of cutoutBrushes) {
    cutoutBrush.updateMatrixWorld()
    const newResult = csgEvaluator.evaluate(resultBrush, cutoutBrush, SUBTRACTION)
    if (resultBrush !== wallBrush) {
      resultBrush.geometry.dispose()
    }
    resultBrush = newResult
  }

  // Clean up
  wallBrush.geometry.dispose()
  for (const brush of cutoutBrushes) {
    brush.geometry.dispose()
  }

  const resultGeometry = resultBrush.geometry
  resultGeometry.computeVertexNormals()
  assignWallMaterialGroups(resultGeometry, wallNode, boundaryEdges)
  ensureUv2Attribute(resultGeometry)

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
      (child.type === 'window' && child.openingKind === 'opening')
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

type ShapedOpeningNode = DoorNode | WindowNode
type CornerRadii = {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

function createShapedOpeningCutoutBrush(opening: ShapedOpeningNode, wallThickness: number): Brush {
  const shape = createShapedOpeningCutoutShape(opening)
  const depth = wallThickness * 2
  const bevelSize =
    opening.openingShape === 'rounded'
      ? Math.min(
          Math.max(opening.openingRevealRadius ?? 0.025, 0),
          Math.max(wallThickness * 0.45, 0.001),
          Math.max((opening.cornerRadius ?? 0.15) * 0.45, 0.001),
        )
      : 0
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelSegments: bevelSize > 0 ? 8 : 0,
    bevelSize,
    bevelThickness: bevelSize,
    curveSegments: 24,
  })

  geometry.translate(0, 0, -depth / 2)
  computeGeometryBoundsTree(geometry)

  return new Brush(geometry)
}

function createShapedOpeningCutoutShape(opening: ShapedOpeningNode): THREE.Shape {
  const halfWidth = opening.width / 2
  const bottom = opening.position[1] - opening.height / 2
  const top = opening.position[1] + opening.height / 2
  const centerX = opening.position[0]
  const left = centerX - halfWidth
  const right = centerX + halfWidth
  const width = Math.max(opening.width, 1e-6)
  const height = Math.max(opening.height, 1e-6)
  const shape = new THREE.Shape()

  if (opening.openingShape === 'arch') {
    const archHeight = Math.min(Math.max(opening.archHeight ?? width / 2, 0.01), height)
    const springY = top - archHeight

    shape.moveTo(left, bottom)
    shape.lineTo(right, bottom)
    shape.lineTo(right, springY)
    shape.quadraticCurveTo(centerX, top, left, springY)
    shape.lineTo(left, bottom)
    shape.closePath()
    return shape
  }

  if (opening.openingShape === 'rounded') {
    const radii = getRoundedOpeningRadii(opening, width, height)
    applyRoundedOpeningShape(shape, left, right, bottom, top, radii)
    return shape
  }

  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, top)
  shape.lineTo(left, top)
  shape.closePath()
  return shape
}

function getRoundedOpeningRadii(
  opening: ShapedOpeningNode,
  width: number,
  height: number,
): CornerRadii {
  if (opening.type !== 'window') {
    if (opening.openingRadiusMode === 'individual') {
      const [topLeft = 0, topRight = 0] = opening.openingTopRadii ?? [0.15, 0.15]

      return normalizeCornerRadii(
        {
          topLeft: Math.max(topLeft, 0),
          topRight: Math.max(topRight, 0),
          bottomRight: 0,
          bottomLeft: 0,
        },
        width,
        height,
      )
    }

    const maxRadius = Math.min(width / 2, height)
    const radius = Math.min(Math.max(opening.cornerRadius ?? 0.15, 0), maxRadius)
    return { topLeft: radius, topRight: radius, bottomRight: 0, bottomLeft: 0 }
  }

  if (opening.openingRadiusMode === 'individual') {
    const [topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0] =
      opening.openingCornerRadii ?? [0.15, 0.15, 0.15, 0.15]

    return normalizeCornerRadii(
      {
        topLeft: Math.max(topLeft, 0),
        topRight: Math.max(topRight, 0),
        bottomRight: Math.max(bottomRight, 0),
        bottomLeft: Math.max(bottomLeft, 0),
      },
      width,
      height,
    )
  }

  const maxRadius = Math.min(width / 2, height / 2)
  const radius = Math.min(Math.max(opening.cornerRadius ?? 0.15, 0), maxRadius)
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
}

function normalizeCornerRadii(radii: CornerRadii, width: number, height: number): CornerRadii {
  const next = { ...radii }
  const maxScale = Math.min(
    1,
    width / Math.max(next.topLeft + next.topRight, 1e-6),
    width / Math.max(next.bottomLeft + next.bottomRight, 1e-6),
    height / Math.max(next.topLeft + next.bottomLeft, 1e-6),
    height / Math.max(next.topRight + next.bottomRight, 1e-6),
  )

  if (maxScale < 1) {
    next.topLeft *= maxScale
    next.topRight *= maxScale
    next.bottomRight *= maxScale
    next.bottomLeft *= maxScale
  }

  return next
}

function applyRoundedOpeningShape(
  shape: THREE.Shape,
  left: number,
  right: number,
  bottom: number,
  top: number,
  radii: CornerRadii,
) {
  const { topLeft, topRight, bottomRight, bottomLeft } = radii

  shape.moveTo(left + bottomLeft, bottom)
  shape.lineTo(right - bottomRight, bottom)
  if (bottomRight > 1e-6) {
    shape.absarc(right - bottomRight, bottom + bottomRight, bottomRight, -Math.PI / 2, 0, false)
  } else {
    shape.lineTo(right, bottom)
  }

  shape.lineTo(right, top - topRight)
  if (topRight > 1e-6) {
    shape.absarc(right - topRight, top - topRight, topRight, 0, Math.PI / 2, false)
  } else {
    shape.lineTo(right, top)
  }

  shape.lineTo(left + topLeft, top)
  if (topLeft > 1e-6) {
    shape.absarc(left + topLeft, top - topLeft, topLeft, Math.PI / 2, Math.PI, false)
  } else {
    shape.lineTo(left, top)
  }

  shape.lineTo(left, bottom + bottomLeft)
  if (bottomLeft > 1e-6) {
    shape.absarc(left + bottomLeft, bottom + bottomLeft, bottomLeft, Math.PI, Math.PI * 1.5, false)
  } else {
    shape.lineTo(left, bottom)
  }

  shape.closePath()
}
