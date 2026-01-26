import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNode, AnyNodeId, WallNode } from '../../schema'
import useScene from '../../store/use-scene'
import {
  calculateLevelMiters,
  getAdjacentWallIds,
  pointToKey,
  type Point2D,
  type WallMiterData,
} from './wall-mitering'

// ============================================================================
// WALL SYSTEM
// ============================================================================

export const WallSystem = () => {
  const { nodes, dirtyNodes, clearDirty } = useScene()

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    // Collect dirty walls and their levels
    const dirtyWallsByLevel = new Map<string, Set<string>>()

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'wall') return

      const levelId = node.parentId
      if (!levelId) return

      if (!dirtyWallsByLevel.has(levelId)) {
        dirtyWallsByLevel.set(levelId, new Set())
      }
      dirtyWallsByLevel.get(levelId)!.add(id)
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
        }
        clearDirty(wallId as AnyNodeId)
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
  })

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
  const node = useScene.getState().nodes[wallId as WallNode['id']]
  if (!node || node.type !== 'wall') return

  const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
  if (!mesh) return

  const childrenIds = node.children || []
  const childrenNodes = childrenIds
    .map((childId) => useScene.getState().nodes[childId])
    .filter((n): n is AnyNode => n !== undefined)

  const newGeo = generateExtrudedWall(node, childrenNodes, miterData)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // Update collision mesh
  const collisionMesh = mesh.getObjectByName('collision-mesh') as THREE.Mesh
  if (collisionMesh) {
    const collisionGeo = generateExtrudedWall(node, [], miterData)
    collisionMesh.geometry.dispose()
    collisionMesh.geometry = collisionGeo
  }

  mesh.position.set(node.start[0], 0, node.start[1])
  const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  mesh.rotation.y = -angle
}

/**
 * Generates extruded wall geometry with mitering (exactly like demo)
 *
 * Key insight from demo: polygon is built in WORLD coordinates first,
 * then we transform to wall-local for the 3D mesh.
 */
export function generateExtrudedWall(
  wallNode: WallNode,
  _childrenNodes: AnyNode[], // TODO: Use for hole cutting (doors/windows)
  miterData: WallMiterData,
) {
  const { junctionData } = miterData

  const wallStart: Point2D = { x: wallNode.start[0], y: wallNode.start[1] }
  const wallEnd: Point2D = { x: wallNode.end[0], y: wallNode.end[1] }
  const height = wallNode.height ?? 2.5
  const thickness = wallNode.thickness ?? 0.1
  const halfT = thickness / 2

  // Wall direction and normal (exactly like demo)
  const v = { x: wallEnd.x - wallStart.x, y: wallEnd.y - wallStart.y }
  const L = Math.sqrt(v.x * v.x + v.y * v.y)
  if (L < 1e-9) {
    return new THREE.BufferGeometry()
  }
  const nUnit = { x: -v.y / L, y: v.x / L }

  // Get junction data for start and end (exactly like demo)
  const keyStart = pointToKey(wallStart)
  const keyEnd = pointToKey(wallEnd)

  const startJunction = junctionData.get(keyStart)?.get(wallNode.id)
  const endJunction = junctionData.get(keyEnd)?.get(wallNode.id)

  console.log(`\n=== Wall ${wallNode.id} ===`)
  console.log('Start:', wallStart, 'End:', wallEnd, 'Thickness:', thickness)
  console.log('Key start:', keyStart, 'Key end:', keyEnd)
  console.log('Start junction data:', startJunction)
  console.log('End junction data:', endJunction)

  // Calculate polygon corners in world coordinates (exactly like demo)
  // p_start_L = left side at start
  // p_start_R = right side at start
  // p_end_L = left side at end
  // p_end_R = right side at end

  const p_start_L: Point2D = startJunction?.left || {
    x: wallStart.x + nUnit.x * halfT,
    y: wallStart.y + nUnit.y * halfT,
  }
  const p_start_R: Point2D = startJunction?.right || {
    x: wallStart.x - nUnit.x * halfT,
    y: wallStart.y - nUnit.y * halfT,
  }

  // At end, SWAP left/right from junction data (exactly like demo)
  // This is because junction stores left/right relative to OUTGOING direction,
  // which is reversed at the end of the wall
  const p_end_L: Point2D = endJunction?.right || {
    x: wallEnd.x + nUnit.x * halfT,
    y: wallEnd.y + nUnit.y * halfT,
  }
  const p_end_R: Point2D = endJunction?.left || {
    x: wallEnd.x - nUnit.x * halfT,
    y: wallEnd.y - nUnit.y * halfT,
  }

  console.log('Polygon corners (world coords):')
  console.log('  p_start_L:', p_start_L, startJunction ? '(from junction)' : '(default)')
  console.log('  p_start_R:', p_start_R, startJunction ? '(from junction)' : '(default)')
  console.log('  p_end_L:', p_end_L, endJunction ? '(from junction, swapped)' : '(default)')
  console.log('  p_end_R:', p_end_R, endJunction ? '(from junction, swapped)' : '(default)')

  // Build polygon points (exactly like demo)
  // Order: start-right -> end-right -> [end center] -> end-left -> start-left -> [start center]
  const polyPoints: Point2D[] = [p_start_R, p_end_R]
  if (endJunction) {
    polyPoints.push(wallEnd) // Add center vertex at junction
  }
  polyPoints.push(p_end_L, p_start_L)
  if (startJunction) {
    polyPoints.push(wallStart) // Add center vertex at junction
  }

  console.log('Polygon order:', polyPoints.length, 'points')
  console.log('  Has end junction:', !!endJunction, '| Has start junction:', !!startJunction)

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

  return geometry
}

/**
 * Creates a Path from a cutout mesh for door/window holes
 * TODO: Integrate with mitered wall geometry
 */
function _createPathFromCutout(
  cutoutMesh: THREE.Mesh,
  wallStart: [number, number],
  wallAngle: number,
  wallWorldY: number,
): THREE.Path | null {
  const geometry = cutoutMesh.geometry
  if (!geometry) return null

  const positions = geometry.attributes.position
  if (!positions) return null

  cutoutMesh.updateWorldMatrix(true, false)

  const uniquePoints: THREE.Vector2[] = []
  const seen = new Set<string>()
  const v3 = new THREE.Vector3()

  const cosAngle = Math.cos(-wallAngle)
  const sinAngle = Math.sin(-wallAngle)

  for (let i = 0; i < positions.count; i++) {
    v3.fromBufferAttribute(positions, i)
    v3.applyMatrix4(cutoutMesh.matrixWorld)

    const worldX = v3.x - wallStart[0]
    const worldZ = v3.z - wallStart[1]

    const localX = worldX * cosAngle - worldZ * sinAngle
    const localY = v3.y - wallWorldY

    const key = `${localX.toFixed(4)},${localY.toFixed(4)}`
    if (!seen.has(key)) {
      seen.add(key)
      uniquePoints.push(new THREE.Vector2(localX, localY))
    }
  }

  if (uniquePoints.length < 3) return null

  // Sort in counter-clockwise order
  const centroid = new THREE.Vector2(0, 0)
  for (const p of uniquePoints) {
    centroid.add(p)
  }
  centroid.divideScalar(uniquePoints.length)

  uniquePoints.sort((a, b) => {
    const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x)
    const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x)
    return angleA - angleB
  })

  const path = new THREE.Path()
  path.moveTo(uniquePoints[0]?.x ?? 0, uniquePoints[0]?.y ?? 0)
  for (let i = 1; i < uniquePoints.length; i++) {
    path.lineTo(uniquePoints[i]?.x ?? 0, uniquePoints[i]?.y ?? 0)
  }
  path.closePath()

  return path
}
