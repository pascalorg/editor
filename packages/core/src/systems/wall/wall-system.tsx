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
  childrenNodes: AnyNode[],
  miters?: { start?: MiterData; end?: MiterData },
) {
  const start = new THREE.Vector2(wallNode.start[0], wallNode.start[1])
  const end = new THREE.Vector2(wallNode.end[0], wallNode.end[1])
  const length = start.distanceTo(end)
  const height = wallNode.height ?? 2.5
  const thickness = wallNode.thickness ?? 0.1
  const halfT = thickness / 2

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

  // Calculate miter offsets at start and end
  // These determine how far the wall extends/retracts at each end for proper joints
  let startLeftZ = halfT
  let startRightZ = -halfT
  let endLeftZ = halfT
  let endRightZ = -halfT

  // Miter offset along the wall's X axis (for angled cuts)
  let startLeftX = 0
  let startRightX = 0
  let endLeftX = length
  let endRightX = length

  if (miters?.start) {
    const left = worldToLocal(miters.start.left)
    const right = worldToLocal(miters.start.right)
    startLeftZ = left.z
    startRightZ = right.z
    startLeftX = left.x
    startRightX = right.x
  }

  if (miters?.end) {
    // At end, left/right are relative to outgoing direction (reversed)
    const left = worldToLocal(miters.end.right)
    const right = worldToLocal(miters.end.left)
    endLeftZ = left.z
    endRightZ = right.z
    endLeftX = left.x
    endRightX = right.x
  }

  // Create the main wall shape (XY plane: X = along wall, Y = height)
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(length, 0)
  shape.lineTo(length, height)
  shape.lineTo(0, height)
  shape.closePath()

  // Process holes (doors/windows)
  const wallStart: [number, number] = [wallNode.start[0], wallNode.start[1]]
  const wallMesh = sceneRegistry.nodes.get(wallNode.id) as THREE.Mesh
  const wallWorldY = wallMesh?.getWorldPosition(new THREE.Vector3()).y ?? 0

  childrenNodes.forEach((child) => {
    if (child.type !== 'item') return

    const childMesh = sceneRegistry.nodes.get(child.id)
    if (!childMesh) return

    const cutoutMesh = childMesh.getObjectByName('cutout') as THREE.Mesh
    if (!cutoutMesh) return

    const holePath = createPathFromCutout(cutoutMesh, wallStart, wallAngle, wallWorldY)
    if (holePath) {
      shape.holes.push(holePath)
    }
  })

  // Create custom extrude geometry with mitered ends
  const geometry = createMiteredExtrudeGeometry(
    shape,
    height,
    {
      leftZ: startLeftZ,
      rightZ: startRightZ,
      leftX: startLeftX,
      rightX: startRightX,
    },
    {
      leftZ: endLeftZ,
      rightZ: endRightZ,
      leftX: endLeftX,
      rightX: endRightX,
    },
  )

  return geometry
}

/**
 * Creates an extruded geometry with mitered (angled) ends
 */
function createMiteredExtrudeGeometry(
  shape: THREE.Shape,
  height: number,
  startMiter: { leftZ: number; rightZ: number; leftX: number; rightX: number },
  endMiter: { leftZ: number; rightZ: number; leftX: number; rightX: number },
): THREE.BufferGeometry {
  // First, create standard extrude geometry
  const thickness = Math.max(
    Math.abs(startMiter.leftZ - startMiter.rightZ),
    Math.abs(endMiter.leftZ - endMiter.rightZ),
    0.1,
  )

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  })

  // Translate so center is at Z=0
  geometry.translate(0, 0, -thickness / 2)

  // Get position attribute for modification
  const positions = geometry.attributes.position
  const vertices = positions.array as Float32Array

  // Modify vertex positions for mitering
  for (let i = 0; i < positions.count; i++) {
    const x = vertices[i * 3]!
    const y = vertices[i * 3 + 1]!
    const z = vertices[i * 3 + 2]!

    // Get shape bounds to determine which end we're at
    const shapePoints = shape.getPoints()
    const minX = Math.min(...shapePoints.map((p: THREE.Vector2) => p.x))
    const maxX = Math.max(...shapePoints.map((p: THREE.Vector2) => p.x))
    const wallLength = maxX - minX

    // Determine position along wall (0 to 1)
    const t = wallLength > 0 ? (x - minX) / wallLength : 0

    // Interpolate Z offset based on position along wall and which side (left/right)
    const isLeftSide = z > 0
    const startZ = isLeftSide ? startMiter.leftZ : startMiter.rightZ
    const endZ = isLeftSide ? endMiter.leftZ : endMiter.rightZ

    // Linear interpolation of Z offset
    const newZ = startZ + t * (endZ - startZ)

    // Also adjust X for angled cuts at ends
    let newX = x
    if (t < 0.01) {
      // Near start
      const startX = isLeftSide ? startMiter.leftX : startMiter.rightX
      newX = startX
    } else if (t > 0.99) {
      // Near end
      const endX = isLeftSide ? endMiter.leftX : endMiter.rightX
      newX = endX
    }

    vertices[i * 3] = newX
    vertices[i * 3 + 2] = newZ
  }

  positions.needsUpdate = true
  geometry.computeVertexNormals()

  return geometry
}

/**
 * Creates a Path from a cutout mesh for door/window holes
 */
function createPathFromCutout(
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
