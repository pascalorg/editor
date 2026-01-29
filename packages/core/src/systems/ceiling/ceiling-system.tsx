import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, CeilingNode } from '../../schema'
import useScene from '../../store/use-scene'

// ============================================================================
// CEILING SYSTEM
// ============================================================================

export const CeilingSystem = () => {
  const { nodes, dirtyNodes, clearDirty } = useScene()

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    // Process dirty ceilings
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'ceiling') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        updateCeilingGeometry(node as CeilingNode, mesh)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  })

  return null
}

/**
 * Updates the geometry for a single ceiling
 */
function updateCeilingGeometry(node: CeilingNode, mesh: THREE.Mesh) {
  const newGeo = generateCeilingGeometry(node)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // Position at the ceiling height
  mesh.position.y = (node.height ?? 2.5) - 0.01 // Slight offset to avoid z-fighting with upper-level slabs
}

/**
 * Generates flat ceiling geometry from polygon (no extrusion)
 */
export function generateCeilingGeometry(ceilingNode: CeilingNode): THREE.BufferGeometry {
  const polygon = ceilingNode.polygon

  if (polygon.length < 3) {
    return new THREE.BufferGeometry()
  }

  // Create shape from polygon
  // Shape is in X-Y plane, we'll rotate to X-Z plane
  const shape = new THREE.Shape()
  const firstPt = polygon[0]!

  // Negate Y (which becomes Z) to get correct orientation after rotation
  shape.moveTo(firstPt[0], -firstPt[1])

  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i]!
    shape.lineTo(pt[0], -pt[1])
  }
  shape.closePath()

  // Create flat shape geometry (no extrusion)
  const geometry = new THREE.ShapeGeometry(shape)

  // Rotate so the shape lies flat in X-Z plane
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()

  return geometry
}
