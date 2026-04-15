import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import type { AnyNode, AnyNodeId, WallNode } from '../../schema'
import useScene from '../../store/use-scene'
import { DEFAULT_WALL_HEIGHT, getWallPlanFootprint, getWallThickness } from './wall-footprint'
import { getWallCurveFrameAt, getWallSurfacePolygon, isCurvedWall } from './wall-curve'
import {
  calculateLevelMiters,
  getAdjacentWallIds,
  getWallMiterBoundaryPoints,
  type Point2D,
  type WallMiterData,
  pointToKey,
} from './wall-mitering'

// Reusable CSG evaluator for better performance
const csgEvaluator = new Evaluator()
const CURVED_WALL_3D_ENDPOINT_INSET = 0.0015

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
  ensureUv2Attribute(geometry)

  // Apply CSG subtraction for cutouts (doors/windows)
  const cutoutBrushes = collectCutoutBrushes(wallNode, childrenNodes, thickness)
  if (cutoutBrushes.length === 0) {
    return geometry
  }

  // Create wall brush from geometry
  // Pre-compute BVH with new API to avoid deprecation warning
  geometry.computeBoundsTree = computeBoundsTree
  geometry.computeBoundsTree({ maxLeafSize: 10 })

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
    boxGeo.computeBoundsTree = computeBoundsTree
    boxGeo.computeBoundsTree({ maxLeafSize: 10 })

    const brush = new Brush(boxGeo)
    brushes.push(brush)
  }

  return brushes
}
