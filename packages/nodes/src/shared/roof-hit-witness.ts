import { type AnyNode, type RoofNode, sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'

export type RoofHitWitness = Pick<
  THREE.Intersection<THREE.Object3D>,
  'object' | 'point' | 'faceIndex'
>

// Native meshes store Float32 coordinates; ownership still requires the actual triangle.
export const ROOF_HIT_TOLERANCE = 0.00005

export function geometryContainsPoint(
  geometry: THREE.BufferGeometry,
  point: THREE.Vector3,
  faceIndex?: number,
  upwardOnly = false,
): boolean {
  const positions = geometry.getAttribute('position')
  if (!positions) return false
  const index = geometry.getIndex()
  const count = index?.count ?? positions.count
  if (
    faceIndex !== undefined &&
    (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex * 3 + 2 >= count)
  )
    return false
  const first = faceIndex === undefined ? 0 : faceIndex * 3
  const end = faceIndex === undefined ? count : first + 3
  const triangle = new THREE.Triangle()
  const nearest = new THREE.Vector3()
  for (let i = first; i + 2 < end; i += 3) {
    triangle.a.fromBufferAttribute(positions, index ? index.getX(i) : i)
    triangle.b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1)
    triangle.c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2)
    if (triangle.getArea() === 0) continue
    if (upwardOnly && triangle.getNormal(nearest).y <= 0) continue
    triangle.closestPointToPoint(point, nearest)
    if (nearest.distanceToSquared(point) <= ROOF_HIT_TOLERANCE ** 2) return true
  }
  return false
}

/** Validate a rendered native roof witness, excluding hosted accessory descendants. */
export function validateRoofHitWitness(
  roof: RoofNode,
  world: THREE.Vector3,
  witness: RoofHitWitness,
  nodes: Readonly<Record<string, AnyNode>>,
): { segmentId?: string; upward: boolean } | null {
  if (
    !witness.point ||
    ![witness.point.x, witness.point.y, witness.point.z].every(Number.isFinite) ||
    witness.point.distanceToSquared(world) > ROOF_HIT_TOLERANCE ** 2
  )
    return null
  const mesh = witness.object as THREE.Mesh
  if (
    !mesh?.isMesh ||
    mesh.geometry?.userData.placeholder ||
    witness.faceIndex === undefined ||
    witness.faceIndex === null
  )
    return null
  const registered = new Map<THREE.Object3D, string>()
  for (const [id, object] of sceneRegistry.nodes) registered.set(object, id)
  const meshId = registered.get(mesh)
  // Native segment geometry lives on its registered mesh; the merged shell is
  // the roof group's direct mesh. A descendant shadow/preview/accessory is neither.
  if (
    nodes[meshId ?? '']?.type !== 'roof-segment' &&
    !(mesh.name === 'merged-roof' && mesh.parent === sceneRegistry.nodes.get(roof.id))
  )
    return null
  let segmentId: string | undefined
  let owned = false
  for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
    if (!object.visible) return null
    const id = registered.get(object)
    if (!id || owned) continue
    const node = nodes[id]
    if (node?.id === roof.id && node.type === 'roof') {
      owned = true
      continue
    }
    if (
      node?.type !== 'roof-segment' ||
      node.parentId !== roof.id ||
      !roof.children.includes(node.id)
    )
      return null
    segmentId = node.id
  }
  if (!owned) return null
  mesh.updateWorldMatrix(true, false)
  const local = mesh.worldToLocal(world.clone())
  if (!geometryContainsPoint(mesh.geometry, local, witness.faceIndex)) return null
  return {
    segmentId,
    upward: geometryContainsPoint(mesh.geometry, local, witness.faceIndex, true),
  }
}
