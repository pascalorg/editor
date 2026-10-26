/**
 * What a conversion could not read and left out or replaced, instead of failing the whole file
 * on one bad number (a NaN vertex used to reject every imported mesh with
 * "Could not build imported mesh node at primitives.0.positions.0").
 */
export interface IfcConversionReport {
  skippedGeometry: {
    /** Placed geometries whose placement matrix had a non-finite entry. */
    transforms: number
    /** Vertices with a non-finite position or normal. */
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
  }
}

export function emptyConversionReport(): IfcConversionReport {
  return {
    skippedGeometry: { transforms: 0, vertices: 0, triangles: 0, primitives: 0, elements: 0 },
    replaced: { unitFactor: false, originOffset: false, levelElevations: 0 },
  }
}

/** True when the report has anything to tell the person. */
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
 * Drops vertices with a non-finite position or normal and every triangle that uses one (or an
 * index past the vertex count), then compacts the vertex buffers to the vertices still used.
 * Returns null when no triangle survives; a source with triangles that all fail counts as a
 * skipped primitive.
 */
export function keepValidTriangles(
  mesh: MeshBuffers,
  skipped: IfcConversionReport['skippedGeometry'],
): MeshBuffers | null {
  const triangleCount = Math.floor(mesh.indices.length / 3)
  if (triangleCount === 0) return null
  const vertexCount = Math.floor(mesh.positions.length / 3)
  const valid = new Uint8Array(vertexCount)
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    let ok = true
    for (let axis = 0; axis < 3; axis++) {
      if (
        !(
          Number.isFinite(mesh.positions[vertex * 3 + axis]) &&
          Number.isFinite(mesh.normals[vertex * 3 + axis])
        )
      ) {
        ok = false
        break
      }
    }
    if (ok) valid[vertex] = 1
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
  return { positions, normals, indices }
}
