import * as THREE from 'three'

/**
 * Rewrites a geometry's material groups so every material is drawn exactly once.
 *
 * A group is a contiguous slice of the index buffer, so a mesh whose triangles
 * alternate between materials pays a draw call per *run*, not per material.
 * Extruded walls hit this hard: `ExtrudeGeometry` emits the cap and side faces
 * interleaved, so run-length grouping produces four groups for two materials —
 * multiplied by a thousand walls, that is thousands of avoidable draw calls.
 * Bucketing the triangles by material first makes each material one run.
 *
 * The geometry gains an index buffer if it had none. Triangle winding, vertex
 * data and material assignment are untouched, so the rendered image is
 * unchanged; only the order in which the GPU is asked to draw it differs.
 */
export function setGroupsSortedByMaterial(
  geometry: THREE.BufferGeometry,
  triangleMaterials: ArrayLike<number>,
): void {
  geometry.clearGroups()

  const position = geometry.getAttribute('position')
  if (!position) return

  const sourceIndex = geometry.getIndex()
  const triangleCount = Math.min(
    triangleMaterials.length,
    sourceIndex ? Math.floor(sourceIndex.count / 3) : Math.floor(position.count / 3),
  )
  if (triangleCount === 0) return

  const buckets = new Map<number, number[]>()
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const material = triangleMaterials[triangle] ?? 0
    const bucket = buckets.get(material)
    if (bucket) bucket.push(triangle)
    else buckets.set(material, [triangle])
  }

  const singleMaterial = buckets.size === 1 ? [...buckets.keys()][0] : undefined
  if (singleMaterial !== undefined) {
    geometry.addGroup(0, triangleCount * 3, singleMaterial)
    return
  }

  const reordered = new Uint32Array(triangleCount * 3)
  let cursor = 0

  for (const [material, triangles] of [...buckets].sort((left, right) => left[0] - right[0])) {
    const groupStart = cursor
    for (const triangle of triangles) {
      const base = triangle * 3
      reordered[cursor] = sourceIndex ? sourceIndex.getX(base) : base
      reordered[cursor + 1] = sourceIndex ? sourceIndex.getX(base + 1) : base + 1
      reordered[cursor + 2] = sourceIndex ? sourceIndex.getX(base + 2) : base + 2
      cursor += 3
    }
    geometry.addGroup(groupStart, cursor - groupStart, material)
  }

  geometry.setIndex(new THREE.BufferAttribute(reordered, 1))
}
