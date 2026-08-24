import * as THREE from 'three'
import type { ManifoldMeshData } from './print-shell-compiler-protocol'

export function geometryToManifoldMeshData(
  geometry: THREE.BufferGeometry,
  nodeId: string,
): ManifoldMeshData {
  const position = geometry.getAttribute('position')
  const positions = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    positions[index * 3] = position.getX(index)
    positions[index * 3 + 1] = position.getY(index)
    positions[index * 3 + 2] = position.getZ(index)
  }
  const geometryIndex = geometry.getIndex()
  const indices = new Uint32Array(geometryIndex?.count ?? position.count)
  for (let index = 0; index < indices.length; index += 1) {
    indices[index] = geometryIndex?.getX(index) ?? index
  }
  return { nodeId, positions, indices }
}

export function geometryFromManifoldMeshData(
  positions: Float32Array,
  indices: Uint32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  return geometry
}
