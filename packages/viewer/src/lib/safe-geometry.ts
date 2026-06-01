import * as THREE from 'three'

const WEBGPU_UV_ATTRIBUTES = ['uv', 'uv1', 'uv2', 'uv3'] as const

/**
 * Returns a geometry with a single degenerate triangle.
 * WebGPU pipelines require a non-empty vertex buffer; a bare
 * `new THREE.BufferGeometry()` has no position attribute, which
 * triggers "Vertex buffer slot 0 was not set" validation errors.
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
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))

  const uv = new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2)
  geo.setAttribute('uv', uv)
  geo.setAttribute('uv1', uv.clone())
  geo.setAttribute('uv2', uv.clone())
  geo.setAttribute('uv3', uv.clone())
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
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

export function ensureWebGPUCompatibleGeometry(
  geometry: THREE.BufferGeometry | null | undefined,
): THREE.BufferGeometry {
  const position = geometry?.getAttribute('position')
  if (!geometry || !position || position.count < 3) {
    return createSafeEmptyGeometry()
  }

  const vertexCount = position.count

  const normal = geometry.getAttribute('normal')
  if (!normal || normal.count !== vertexCount) {
    geometry.deleteAttribute('normal')
    try {
      geometry.computeVertexNormals()
    } catch {
      // Fall through to the flat fallback below.
    }
  }

  const computedNormal = geometry.getAttribute('normal')
  if (!computedNormal || computedNormal.count !== vertexCount) {
    const values = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i += 1) {
      values[i * 3 + 1] = 1
    }
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(values, 3))
  }

  for (const attributeName of WEBGPU_UV_ATTRIBUTES) {
    ensureFloatAttribute(geometry, attributeName, vertexCount, 2, 0)
  }

  const tangent = geometry.getAttribute('tangent')
  if (!tangent || tangent.count !== vertexCount || tangent.itemSize !== 4) {
    geometry.deleteAttribute('tangent')
    try {
      if (geometry.index && geometry.getAttribute('uv')) {
        geometry.computeTangents()
      }
    } catch {
      // Fall through to the stable fallback tangent below.
    }
  }

  ensureFloatAttribute(geometry, 'tangent', vertexCount, 4, (component) => {
    if (component === 0) return 1
    if (component === 3) return 1
    return 0
  })
  ensureFloatAttribute(geometry, 'color', vertexCount, 3, 1)

  if (!geometry.boundingSphere) {
    try {
      geometry.computeBoundingSphere()
    } catch {
      // Bounding data is a draw optimization, not worth failing render setup.
    }
  }

  return geometry
}

export function ensureMeshWebGPUCompatibleGeometry(mesh: THREE.Mesh): void {
  const safeGeometry = ensureWebGPUCompatibleGeometry(mesh.geometry)
  if (safeGeometry !== mesh.geometry) {
    mesh.geometry = safeGeometry
  }
}

export function ensureObjectWebGPUCompatibleGeometry(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    ensureMeshWebGPUCompatibleGeometry(child as THREE.Mesh)
  })
}

function ensureFloatAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
  vertexCount: number,
  itemSize: number,
  value: number | ((component: number) => number),
) {
  const existing = geometry.getAttribute(name)
  if (existing && existing.count === vertexCount && existing.itemSize === itemSize) {
    return
  }

  const values = new Float32Array(vertexCount * itemSize)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < itemSize; component += 1) {
      values[vertex * itemSize + component] = typeof value === 'function' ? value(component) : value
    }
  }
  geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, itemSize))
}
