import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, SlabNode } from '../../schema'
import useScene from '../../store/use-scene'

// ============================================================================
// SLAB SYSTEM
// ============================================================================

export const SlabSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    // Process dirty slabs
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'slab') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        updateSlabGeometry(node as SlabNode, mesh)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
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

/** Half of default wall thickness — used to extend slab geometry under walls */
const SLAB_OUTSET = 0.05

/**
 * Expand a polygon outward by a uniform distance.
 * Offsets each edge outward then intersects consecutive offset edges.
 */
function outsetPolygon(polygon: Array<[number, number]>, amount: number): Array<[number, number]> {
  const n = polygon.length
  if (n < 3) return polygon

  // Determine winding via signed area
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area2 += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1]
  }
  const s = area2 >= 0 ? 1 : -1

  // Offset each edge outward by amount
  const offEdges: Array<[number, number, number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = polygon[j]![0] - polygon[i]![0]
    const dz = polygon[j]![1] - polygon[i]![1]
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len < 1e-9) {
      offEdges.push([polygon[i]![0], polygon[i]![1], dx, dz])
      continue
    }
    const nx = (s * dz / len) * amount
    const nz = (s * -dx / len) * amount
    offEdges.push([polygon[i]![0] + nx, polygon[i]![1] + nz, dx, dz])
  }

  // Intersect consecutive offset edges to get new vertices
  const result: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [ax, az, adx, adz] = offEdges[i]!
    const [bx, bz, bdx, bdz] = offEdges[j]!
    const denom = adx * bdz - adz * bdx
    if (Math.abs(denom) < 1e-9) {
      // Parallel edges — use offset endpoint
      result.push([ax + adx, az + adz])
    } else {
      const t = ((bx - ax) * bdz - (bz - az) * bdx) / denom
      result.push([ax + t * adx, az + t * adz])
    }
  }

  return result
}

/**
 * Generates extruded slab geometry from polygon
 */
export function generateSlabGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const polygon = outsetPolygon(slabNode.polygon, SLAB_OUTSET)
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

  // Add holes to the shape
  const holes = slabNode.holes || []
  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue

    const holePath = new THREE.Path()
    const holeFirstPt = holePolygon[0]!
    holePath.moveTo(holeFirstPt[0], -holeFirstPt[1])

    for (let i = 1; i < holePolygon.length; i++) {
      const pt = holePolygon[i]!
      holePath.lineTo(pt[0], -pt[1])
    }
    holePath.closePath()

    shape.holes.push(holePath)
  }

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
