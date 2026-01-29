import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, RoofNode } from '../../schema'
import useScene from '../../store/use-scene'

// ============================================================================
// ROOF SYSTEM
// ============================================================================

export const RoofSystem = () => {
  const { nodes, dirtyNodes, clearDirty } = useScene()

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    // Process dirty roofs
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'roof') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        updateRoofGeometry(node as RoofNode, mesh)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  })

  return null
}

/**
 * Updates the geometry and transform for a single roof
 */
function updateRoofGeometry(node: RoofNode, mesh: THREE.Mesh) {
  const newGeo = generateRoofGeometry(node)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // Update position and rotation
  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.y = node.rotation
}

/**
 * Generates gable roof geometry from length, height, leftWidth, rightWidth
 *
 * The roof is centered at origin (position applied via mesh transform)
 * - Ridge runs along the X axis (length direction)
 * - Left slope goes down toward -Z with horizontal distance leftWidth
 * - Right slope goes down toward +Z with horizontal distance rightWidth
 * - Total width = leftWidth + rightWidth
 * - Gable ends at -X/2 and +X/2
 */
export function generateRoofGeometry(roofNode: RoofNode): THREE.BufferGeometry {
  const { length, height, leftWidth, rightWidth } = roofNode

  // Half length for centering
  const halfLength = length / 2

  // Ridge is at Y = height, centered at Z = 0
  // Left eave is at Z = -leftWidth, Y = 0
  // Right eave is at Z = +rightWidth, Y = 0

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  const addVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const idx = positions.length / 3
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    return idx
  }

  // Calculate slope normals
  // Left slope: from (0, height, 0) to (0, 0, -leftWidth)
  const leftSlopeLen = Math.sqrt(height * height + leftWidth * leftWidth)
  const leftNormalY = leftWidth / leftSlopeLen
  const leftNormalZ = height / leftSlopeLen

  // Right slope: from (0, height, 0) to (0, 0, +rightWidth)
  const rightSlopeLen = Math.sqrt(height * height + rightWidth * rightWidth)
  const rightNormalY = rightWidth / rightSlopeLen
  const rightNormalZ = height / rightSlopeLen

  // Left slope (negative Z side) - CCW winding for outward-facing
  const leftNormal = [0, leftNormalY, -leftNormalZ] as const
  const v0 = addVertex(-halfLength, 0, -leftWidth, ...leftNormal) // back-left eave
  const v1 = addVertex(halfLength, 0, -leftWidth, ...leftNormal)  // front-left eave
  const v2 = addVertex(halfLength, height, 0, ...leftNormal)      // front ridge
  const v3 = addVertex(-halfLength, height, 0, ...leftNormal)     // back ridge
  indices.push(v0, v2, v1, v0, v3, v2)

  // Right slope (positive Z side) - CCW winding for outward-facing
  const rightNormal = [0, rightNormalY, rightNormalZ] as const
  const v4 = addVertex(halfLength, 0, rightWidth, ...rightNormal)  // front-right eave
  const v5 = addVertex(-halfLength, 0, rightWidth, ...rightNormal) // back-right eave
  const v6 = addVertex(-halfLength, height, 0, ...rightNormal)     // back ridge
  const v7 = addVertex(halfLength, height, 0, ...rightNormal)      // front ridge
  indices.push(v4, v6, v5, v4, v7, v6)

  // Front gable end (positive X) - CCW winding for outward-facing
  const frontNormal = [1, 0, 0] as const
  const v8 = addVertex(halfLength, 0, -leftWidth, ...frontNormal)
  const v9 = addVertex(halfLength, 0, rightWidth, ...frontNormal)
  const v10 = addVertex(halfLength, height, 0, ...frontNormal)
  indices.push(v8, v10, v9)

  // Back gable end (negative X) - CCW winding for outward-facing
  const backNormal = [-1, 0, 0] as const
  const v11 = addVertex(-halfLength, 0, rightWidth, ...backNormal)
  const v12 = addVertex(-halfLength, 0, -leftWidth, ...backNormal)
  const v13 = addVertex(-halfLength, height, 0, ...backNormal)
  indices.push(v11, v13, v12)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)

  return geometry
}
