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
  // One degenerate triangle: satisfies the vertex buffer requirement but
  // produces no visible pixels. Include the common vertex attributes
  // NodeMaterials may compile into their WebGPU pipeline; if a previously
  // compiled pipeline asks for a secondary slot, WebGPU validates that slot
  // even for an invisible placeholder draw.
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3),
  )

  const uv = new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2)
  geo.setAttribute('uv', uv)
  geo.setAttribute('uv1', uv.clone())
  geo.setAttribute('uv2', uv.clone())
  geo.setAttribute('uv3', uv.clone())
  geo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
  )
  geo.setAttribute(
    'tangent',
    new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4),
  )
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3))
  geo.computeBoundingSphere()

  // These placeholders are tiny and can be replaced by imperative systems
  // during the same render lifecycle. WebGPU can otherwise observe a destroyed
  // vertex buffer through renderer-side binding caches and fail validation.
  geo.dispose = () => {}
  return geo
}
