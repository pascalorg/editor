/**
 * What a conversion could not read and left out or replaced, instead of failing the whole file
 * on one bad number (a NaN vertex used to reject every imported mesh with
 * "Could not build imported mesh node at primitives.0.positions.0").
 */
export interface IfcConversionReport {
  skippedGeometry: {
    /** Placed geometries whose placement matrix had a non-finite entry. */
    transforms: number
    /** Vertices with a non-finite position. */
    vertices: number
    /** Triangles that used a skipped or missing vertex. */
    triangles: number
    /** Mesh pieces left with no valid triangle. */
    primitives: number
    /** Elements left out because none of their geometry could be read. */
    elements: number
  }
  /** Values that were not finite and fell back to a neutral default. */
  replaced: {
    unitFactor: boolean
    originOffset: boolean
    levelElevations: number
    /** Vertex normals recomputed from the faces around them: shading only, nothing lost. */
    normals: number
  }
}

export function emptyConversionReport(): IfcConversionReport {
  return {
    skippedGeometry: { transforms: 0, vertices: 0, triangles: 0, primitives: 0, elements: 0 },
    replaced: { unitFactor: false, originOffset: false, levelElevations: 0, normals: 0 },
  }
}

/** True when the report has anything to tell the person (a recomputed normal loses nothing). */
export function conversionReportHasIssues(report: IfcConversionReport): boolean {
  const { skippedGeometry, replaced } = report
  return (
    skippedGeometry.transforms +
      skippedGeometry.vertices +
      skippedGeometry.triangles +
      skippedGeometry.primitives +
      skippedGeometry.elements +
      replaced.levelElevations >
      0 ||
    replaced.unitFactor ||
    replaced.originOffset
  )
}

export function isFiniteMatrix(matrix: ArrayLike<number> | null | undefined): boolean {
  if (!matrix || matrix.length < 16) return false
  for (let i = 0; i < 16; i++) if (!Number.isFinite(matrix[i])) return false
  return true
}

export interface MeshBuffers {
  positions: number[]
  normals: number[]
  indices: number[]
}

/**
 * Drops vertices with a non-finite position and every triangle that uses one (or an index past
 * the vertex count), then compacts the vertex buffers to the vertices still used. A non-finite
 * normal on a kept vertex is shading, not shape: it is recomputed from the kept triangles around
 * it (zero when they have no area). Returns null when no triangle survives; a source with
 * triangles that all fail counts as a skipped primitive.
 */
export function keepValidTriangles(
  mesh: MeshBuffers,
  report: IfcConversionReport,
): MeshBuffers | null {
  const skipped = report.skippedGeometry
  const triangleCount = Math.floor(mesh.indices.length / 3)
  if (triangleCount === 0) return null
  const vertexCount = Math.floor(mesh.positions.length / 3)
  const valid = new Uint8Array(vertexCount)
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    if (finiteTriple(mesh.positions, vertex)) valid[vertex] = 1
    else skipped.vertices++
  }

  const remap = new Int32Array(vertexCount).fill(-1)
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const corners = [
      mesh.indices[triangle * 3]!,
      mesh.indices[triangle * 3 + 1]!,
      mesh.indices[triangle * 3 + 2]!,
    ]
    if (
      !corners.every(
        (index) => Number.isInteger(index) && index >= 0 && index < vertexCount && valid[index],
      )
    ) {
      skipped.triangles++
      continue
    }
    for (const index of corners) {
      if (remap[index] === -1) {
        remap[index] = positions.length / 3
        positions.push(
          mesh.positions[index * 3]!,
          mesh.positions[index * 3 + 1]!,
          mesh.positions[index * 3 + 2]!,
        )
        normals.push(
          mesh.normals[index * 3]!,
          mesh.normals[index * 3 + 1]!,
          mesh.normals[index * 3 + 2]!,
        )
      }
      indices.push(remap[index]!)
    }
  }

  if (indices.length === 0) {
    skipped.primitives++
    return null
  }
  report.replaced.normals += recomputeNonFiniteNormals(positions, normals, indices)
  return { positions, normals, indices }
}

function finiteTriple(values: number[], vertex: number): boolean {
  return (
    Number.isFinite(values[vertex * 3]) &&
    Number.isFinite(values[vertex * 3 + 1]) &&
    Number.isFinite(values[vertex * 3 + 2])
  )
}

// A vertex whose faces have no area has no direction to take; a unit normal keeps lighting sane.
const FALLBACK_NORMAL = [0, 0, 1] as const

/**
 * Each non-finite normal becomes the area-weighted normal of the triangles at its vertex, or the
 * fallback when they have no area. Returns how many were recomputed. Accumulates in typed arrays:
 * a whole mesh can need it (__bench__/normal-recompute.bench.ts).
 */
function recomputeNonFiniteNormals(
  positions: number[],
  normals: number[],
  indices: number[],
): number {
  const vertexCount = positions.length / 3
  const slotOf = new Int32Array(vertexCount).fill(-1)
  let broken = 0
  for (let vertex = 0; vertex < vertexCount; vertex++)
    if (!finiteTriple(normals, vertex)) slotOf[vertex] = broken++
  if (broken === 0) return 0
  const sums = new Float64Array(broken * 3)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    if (slotOf[a]! < 0 && slotOf[b]! < 0 && slotOf[c]! < 0) continue
    const ux = positions[b * 3]! - positions[a * 3]!
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!
    const vx = positions[c * 3]! - positions[a * 3]!
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!
    const fx = uy * vz - uz * vy
    const fy = uz * vx - ux * vz
    const fz = ux * vy - uy * vx
    for (const corner of [a, b, c]) {
      const slot = slotOf[corner]!
      if (slot < 0) continue
      sums[slot * 3] += fx
      sums[slot * 3 + 1] += fy
      sums[slot * 3 + 2] += fz
    }
  }
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const slot = slotOf[vertex]!
    if (slot < 0) continue
    const x = sums[slot * 3]!
    const y = sums[slot * 3 + 1]!
    const z = sums[slot * 3 + 2]!
    // Coordinates past ~1e154 overflow the summed cross products: Infinity, not a direction.
    const length = Math.hypot(x, y, z)
    const normal =
      length > 0 && Number.isFinite(length) ? [x / length, y / length, z / length] : FALLBACK_NORMAL
    for (let axis = 0; axis < 3; axis++)
      normals[vertex * 3 + axis] = Math.round(normal[axis]! * 1000) / 1000 || 0
  }
  return broken
}
