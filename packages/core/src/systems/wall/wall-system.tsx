import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNode, AnyNodeId, WallNode } from '../../schema'
import useScene from '../../store/use-scene'
import {
  calculateLevelMiters,
  getAdjacentWallIds,
  type MiterData,
  type Point2D,
  type WallMiterMap,
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
      const miterMap = calculateLevelMiters(levelWalls)

      // Update dirty walls
      for (const wallId of dirtyWallIds) {
        const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
        if (mesh) {
          updateWallGeometry(wallId, miterMap)
        }
        clearDirty(wallId as AnyNodeId)
      }

      // Update adjacent walls that share junctions
      const adjacentWallIds = getAdjacentWallIds(levelWalls, dirtyWallIds)
      for (const wallId of adjacentWallIds) {
        if (!dirtyWallIds.has(wallId)) {
          const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
          if (mesh) {
            updateWallGeometry(wallId, miterMap)
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
function updateWallGeometry(wallId: string, miterMap: WallMiterMap) {
  const node = useScene.getState().nodes[wallId as WallNode['id']]
  if (!node || node.type !== 'wall') return

  const mesh = sceneRegistry.nodes.get(wallId) as THREE.Mesh
  if (!mesh) return

  const childrenIds = node.children || []
  const childrenNodes = childrenIds
    .map((childId) => useScene.getState().nodes[childId])
    .filter((n): n is AnyNode => n !== undefined)

  const miters = miterMap.get(wallId)
  const newGeo = generateExtrudedWall(node, childrenNodes, miters)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // Update collision mesh
  const collisionMesh = mesh.getObjectByName('collision-mesh') as THREE.Mesh
  if (collisionMesh) {
    const collisionGeo = generateExtrudedWall(node, [], miters)
    collisionMesh.geometry.dispose()
    collisionMesh.geometry = collisionGeo
  }

  mesh.position.set(node.start[0], 0, node.start[1])
  const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  mesh.rotation.y = -angle
}

/**
 * Generates extruded wall geometry with mitering and holes
 *
 * Geometry approach:
 * - Shape is drawn on XY plane (X = along wall, Y = height)
 * - Extruded by wall thickness along Z
 * - This allows holes (doors/windows) to work correctly on the wall face
 * - Mitering adjusts the extrusion offset at start/end
 */
export function generateExtrudedWall(
  wallNode: WallNode,
  _childrenNodes: AnyNode[], // TODO: Use for hole cutting (doors/windows)
  miters?: { start?: MiterData; end?: MiterData },
) {
  const start = new THREE.Vector2(wallNode.start[0], wallNode.start[1])
  const end = new THREE.Vector2(wallNode.end[0], wallNode.end[1])
  const length = start.distanceTo(end)
  const height = wallNode.height ?? 2.5
  const thickness = wallNode.thickness ?? 0.1
  const halfT = thickness / 2

  console.log(`\n=== generateExtrudedWall: ${wallNode.id} ===`)
  console.log('Wall:', { start: wallNode.start, end: wallNode.end, length, thickness })
  console.log('Miters received:', miters)

  // Wall angle for coordinate transforms
  const wallAngle = Math.atan2(end.y - start.y, end.x - start.x)
  const cosA = Math.cos(-wallAngle)
  const sinA = Math.sin(-wallAngle)

  // Transform world point to wall-local space
  const worldToLocal = (worldPt: Point2D): { x: number; z: number } => {
    const dx = worldPt.x - wallNode.start[0]
    const dy = worldPt.y - wallNode.start[1]
    return {
      x: dx * cosA - dy * sinA,
      z: dx * sinA + dy * cosA,
    }
  }

  // Default miter points (no junction - simple rectangle)
  const defaultStart = {
    left: { x: 0, z: halfT },
    right: { x: 0, z: -halfT },
    center: { x: 0, z: 0 },
    hasJunction: false,
  }
  const defaultEnd = {
    left: { x: length, z: halfT },
    right: { x: length, z: -halfT },
    center: { x: length, z: 0 },
    hasJunction: false,
  }

  // Apply miter data if available
  let startMiter = defaultStart
  let endMiter = defaultEnd

  if (miters?.start) {
    const left = worldToLocal(miters.start.left)
    const right = worldToLocal(miters.start.right)
    const center = worldToLocal(miters.start.center)
    startMiter = { left, right, center, hasJunction: true }
  }

  if (miters?.end) {
    // At end, left/right are swapped because outgoing direction is reversed
    const left = worldToLocal(miters.end.right)
    const right = worldToLocal(miters.end.left)
    const center = worldToLocal(miters.end.center)
    endMiter = { left, right, center, hasJunction: true }
  }

  // Create geometry
  const geometry = createMiteredExtrudeGeometry(height, startMiter, endMiter)

  return geometry
}

interface MiterPoint {
  x: number
  z: number
}

interface MiterEnd {
  left: MiterPoint
  right: MiterPoint
  center: MiterPoint
  hasJunction: boolean
}

/**
 * Creates wall geometry using footprint polygon approach
 *
 * Footprint has 6 vertices - 3 on each thickness edge (start/end):
 * - start-right, start-center (if junction), start-left
 * - end-left, end-center (if junction), end-right
 *
 * Based on the prototype: center vertices are only added when there's a junction
 */
function createMiteredExtrudeGeometry(
  height: number,
  startMiter: MiterEnd,
  endMiter: MiterEnd,
): THREE.BufferGeometry {
  // Build footprint polygon (CCW winding, viewed from above)
  // Following prototype: start-right -> end-right -> [end-center] -> end-left -> start-left -> [start-center]
  const footprint = new THREE.Shape()

  // Start from start-right, go to end-right
  footprint.moveTo(startMiter.right.x, -startMiter.right.z)
  footprint.lineTo(endMiter.right.x, -endMiter.right.z)

  // Add end-center if there's a junction at end
  if (endMiter.hasJunction) {
    footprint.lineTo(endMiter.center.x, -endMiter.center.z)
  }

  // Continue to end-left, then start-left
  footprint.lineTo(endMiter.left.x, -endMiter.left.z)
  footprint.lineTo(startMiter.left.x, -startMiter.left.z)

  // Add start-center if there's a junction at start
  if (startMiter.hasJunction) {
    footprint.lineTo(startMiter.center.x, -startMiter.center.z)
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
