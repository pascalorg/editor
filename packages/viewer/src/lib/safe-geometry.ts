import * as THREE from 'three'

/**
 * Returns a geometry with a single degenerate triangle.
 * WebGPU pipelines require a non-empty vertex buffer; a bare
 * `new THREE.BufferGeometry()` has no position attribute, which
 * triggers "Vertex buffer slot 0 … was not set" validation errors.
 *
 * Use this as the return value whenever a system cannot produce
 * valid geometry (degenerate polygon, zero-length wall, etc.)
 * instead of returning an empty `BufferGeometry`.
 */
export function createSafeEmptyGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  // One degenerate triangle — satisfies the vertex buffer requirement
  // but produces no visible pixels. Includes uv + normal so materials
  // that reference these attributes (e.g. MeshBasicNodeMaterial with
  // TSL gradient nodes) don't trigger WebGPU validation errors.
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3),
  )
  geo.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2),
  )
  geo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
  )
  return geo
}
