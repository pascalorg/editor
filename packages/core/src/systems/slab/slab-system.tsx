import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import type { AnyNodeId, SlabNode } from '../../schema'
import useScene from '../../store/use-scene'

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

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
  }, 1)

  return null
}

/**
 * Updates the geometry for a single slab
 */
function updateSlabGeometry(node: SlabNode, mesh: THREE.Mesh) {
  const newGeo = generateSlabGeometry(node)
  ensureUv2Attribute(newGeo)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // For negative elevation, shift the mesh down so the top face sits at Y=elevation
  // rather than at Y=0. Positive elevation stays at Y=0 (slab sits at floor level).
  const elevation = node.elevation ?? 0.05
  mesh.position.y = elevation < 0 ? elevation : 0
}

/**
 * Generates extruded slab geometry from polygon
 */
export function generateSlabGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const elevation = slabNode.elevation ?? 0.05
  return elevation < 0 ? generatePoolGeometry(slabNode) : generatePositiveSlabGeometry(slabNode)
}

/**
 * Standard slab: flat extrusion upward from Y=0 by elevation thickness.
 */
function generatePositiveSlabGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const polygon = getRenderableSlabPolygon(slabNode)
  const elevation = slabNode.elevation ?? 0.05

  if (polygon.length < 3) return new THREE.BufferGeometry()

  const shape = new THREE.Shape()
  shape.moveTo(polygon[0]![0], -polygon[0]![1])
  for (let i = 1; i < polygon.length; i++) shape.lineTo(polygon[i]![0], -polygon[i]![1])
  shape.closePath()

  for (const holePolygon of slabNode.holes ?? []) {
    if (holePolygon.length < 3) continue
    const holePath = new THREE.Path()
    holePath.moveTo(holePolygon[0]![0], -holePolygon[0]![1])
    for (let i = 1; i < holePolygon.length; i++)
      holePath.lineTo(holePolygon[i]![0], -holePolygon[i]![1])
    holePath.closePath()
    shape.holes.push(holePath)
  }

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: elevation, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Pool / recessed slab: floor cap at Y=0 (local) + inner walls up to Y=|elevation|.
 * No top cap — the opening at ground level is handled by the ground occluder hole.
 * mesh.position.y must be set to elevation so the floor sits at the correct world Y.
 *
 * Geometry is built directly in 3D (Y-up) to avoid rotation confusion:
 *   - floor in XZ plane at Y=0, normals pointing +Y (visible when looking down into pool)
 *   - walls from Y=0 to Y=depth, inward-facing normals (visible from inside pool)
 */
function generatePoolGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const polygon = getRenderableSlabPolygon(slabNode)
  const depth = Math.abs(slabNode.elevation ?? 0.05)

  if (polygon.length < 3) return new THREE.BufferGeometry()

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const n = polygon.length
  const bounds = new THREE.Box2()

  for (const [x, z] of polygon) {
    bounds.expandByPoint(new THREE.Vector2(x, z))
  }
  for (const hole of slabNode.holes ?? []) {
    for (const [x, z] of hole) {
      bounds.expandByPoint(new THREE.Vector2(x, z))
    }
  }

  const floorWidth = Math.max(bounds.max.x - bounds.min.x, 0.001)
  const floorHeight = Math.max(bounds.max.y - bounds.min.y, 0.001)

  const pushFloorVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z)
    uvs.push((x - bounds.min.x) / floorWidth, (z - bounds.min.y) / floorHeight)
  }

  const pushWallVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z)
    uvs.push(u, v)
  }

  // --- Floor at Y=0 ---
  for (const [x, z] of polygon) pushFloorVertex(x!, 0, z!)

  const pts2d = polygon.map(([x, z]) => new THREE.Vector2(x!, z!))
  const holesPts2d = (slabNode.holes ?? []).map((h) => h.map(([x, z]) => new THREE.Vector2(x!, z!)))
  for (const hole of slabNode.holes ?? []) {
    for (const [x, z] of hole) pushFloorVertex(x!, 0, z!)
  }

  const floorTris = THREE.ShapeUtils.triangulateShape(pts2d, holesPts2d)
  for (const tri of floorTris) {
    // Reversed winding → normals point +Y (upward) in XZ plane
    indices.push(tri[0]!, tri[2]!, tri[1]!)
  }

  // --- Inner walls (no top cap at Y=depth) ---
  // Standard winding on a CCW polygon in XZ gives inward-facing normals.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [x0, z0] = polygon[i]!
    const [x1, z1] = polygon[j]!
    const vBase = positions.length / 3
    const segmentLength = Math.max(Math.hypot(x1 - x0, z1 - z0), 0.001)

    pushWallVertex(x0!, 0, z0!, 0, 0) // v0 — floor level
    pushWallVertex(x1!, 0, z1!, segmentLength, 0) // v1 — floor level
    pushWallVertex(x1!, depth, z1!, segmentLength, depth) // v2 — ground level
    pushWallVertex(x0!, depth, z0!, 0, depth) // v3 — ground level

    indices.push(vBase, vBase + 1, vBase + 2)
    indices.push(vBase, vBase + 2, vBase + 3)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
