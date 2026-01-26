import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, SlabNode } from '../../schema'
import useScene from '../../store/use-scene'

// ============================================================================
// SLAB SYSTEM
// ============================================================================

export const SlabSystem = () => {
  const { nodes, dirtyNodes, clearDirty } = useScene()

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    // Process dirty slabs
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'slab') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        updateSlabGeometry(node as SlabNode, mesh)
      }
      clearDirty(id as AnyNodeId)
    })
  })

  return null
}

/**
 * Updates the geometry for a single slab
 */
function updateSlabGeometry(node: SlabNode, mesh: THREE.Mesh) {
  const newGeo = generateSlabGeometry(node)

  mesh.geometry.dispose()
  mesh.geometry = newGeo
}

/**
 * Generates extruded slab geometry from polygon
 */
export function generateSlabGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const polygon = slabNode.polygon
  const elevation = slabNode.elevation ?? 0.05

  if (polygon.length < 3) {
    return new THREE.BufferGeometry()
  }

  // Create shape from polygon
  // Shape is in X-Y plane, we'll rotate to X-Z plane after extrusion
  const shape = new THREE.Shape()
  const firstPt = polygon[0]!

  // Negate Y (which becomes Z) to get correct orientation after rotation
  shape.moveTo(firstPt[0], -firstPt[1])

  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i]!
    shape.lineTo(pt[0], -pt[1])
  }
  shape.closePath()

  // Extrude the shape by elevation
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: elevation,
    bevelEnabled: false,
  })

  // Rotate so extrusion direction (Z) becomes height direction (Y)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()

  return geometry
}
