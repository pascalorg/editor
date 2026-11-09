import { difference, type Ring, union } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, ShapeUtils, Vector2 } from 'three'
import type { TerrainMeshBuffers } from './terrain-geometry'

type Sample = { indices: number[]; weights: number[] }
export type TerrainHoleBoundary = { geometry: BufferGeometry; samples: Sample[] }

// Keep the regular grid's vertex layout for partial brush uploads. Only triangles
// crossing an excavation rim need additional vertices, interpolated on that grid.
export function cutTerrainHoles(
  buffers: TerrainMeshBuffers,
  holes: Ring[],
): TerrainHoleBoundary | null {
  if (!holes.length) return null
  const cutouts = union(holes)
  const bounds = cutouts.map(({ outer }) => ({
    minX: Math.min(...outer.map(([x]) => x)),
    maxX: Math.max(...outer.map(([x]) => x)),
    minZ: Math.min(...outer.map(([, z]) => z)),
    maxZ: Math.max(...outer.map(([, z]) => z)),
  }))
  const kept: number[] = [],
    indices: number[] = [],
    samples: Sample[] = []
  for (let i = 0; i < buffers.indices.length; i += 3) {
    const source = Array.from(buffers.indices.subarray(i, i + 3))
    const triangle: Ring = source.map((id) => [
      buffers.positions[id * 3]!,
      buffers.positions[id * 3 + 2]!,
    ])
    const xs = triangle.map(([x]) => x),
      zs = triangle.map(([, z]) => z)
    if (
      !bounds.some(
        (box) =>
          box.maxX > Math.min(...xs) &&
          box.minX < Math.max(...xs) &&
          box.maxZ > Math.min(...zs) &&
          box.minZ < Math.max(...zs),
      )
    ) {
      kept.push(...source)
      continue
    }
    const [a, b, c] = triangle as [[number, number], [number, number], [number, number]]
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    for (const polygon of difference(triangle, cutouts)) {
      const contour = polygon.outer.map(([x, z]) => new Vector2(x, z))
      const voids = polygon.holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)))
      const offset = samples.length
      for (const { x, y: z } of [contour, ...voids].flat()) {
        const wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (z - c[1])) / determinant
        const wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / determinant
        samples.push({ indices: source, weights: [wa, wb, 1 - wa - wb] })
      }
      for (const [a, b, c] of ShapeUtils.triangulateShape(contour, voids))
        indices.push(offset + c!, offset + b!, offset + a!)
    }
  }
  buffers.indices = new Uint32Array(kept)
  const geometry = new BufferGeometry()
  for (const name of ['position', 'normal'] as const)
    geometry.setAttribute(
      name,
      new BufferAttribute(new Float32Array(samples.length * 3), 3).setUsage(DynamicDrawUsage),
    )
  const uv = new Float32Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++)
    for (let axis = 0; axis < 2; axis++)
      uv[i * 2 + axis] = samples[i]!.indices.reduce(
        (sum, id, j) => sum + buffers.uvs[id * 2 + axis]! * samples[i]!.weights[j]!,
        0,
      )
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  const boundary = { geometry, samples }
  updateTerrainHoleBoundary(boundary, buffers)
  return boundary
}

export function updateTerrainHoleBoundary(
  boundary: TerrainHoleBoundary,
  buffers: TerrainMeshBuffers,
): void {
  for (const [name, source] of [
    ['position', buffers.positions],
    ['normal', buffers.normals],
  ] as const) {
    const attribute = boundary.geometry.getAttribute(name) as BufferAttribute
    for (let i = 0; i < boundary.samples.length; i++) {
      const sample = boundary.samples[i]!
      for (let axis = 0; axis < 3; axis++)
        attribute.array[i * 3 + axis] = sample.indices.reduce(
          (sum, id, j) => sum + source[id * 3 + axis]! * sample.weights[j]!,
          0,
        )
    }
    attribute.needsUpdate = true
  }
  boundary.geometry.normalizeNormals()
  boundary.geometry.computeBoundingSphere()
}
