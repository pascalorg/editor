import { difference, type Ring, union } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, ShapeUtils, Vector2 } from 'three'
import type { TerrainMeshBuffers } from './terrain-geometry'

type Sample = { indices: number[]; weights: number[] }
/** An edge of the kept ground that runs along a hole's edge, the kept ground on its left. */
export type TerrainHoleRim = { a: number; b: number }
export type TerrainHoleBoundary = {
  geometry: BufferGeometry
  samples: Sample[]
  /** The plan position of each sample as clipped, before the geometry's single precision. */
  points: [number, number][]
  /** Indices into `samples`: the ground's cut edge, vertex for vertex. */
  rim: TerrainHoleRim[]
}

/**
 * How near a hole's edge a clipped edge's midpoint must lie to be the ground's cut edge: the
 * polygon clipper works on a 0.1 mm lattice, so a clipped vertex is up to 0.06 mm off the ring.
 */
const ON_EDGE_M = 2e-4

function signedArea(ring: readonly (readonly [number, number])[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i] as readonly [number, number]
    const [x1, z1] = ring[(i + 1) % ring.length] as readonly [number, number]
    area += x0 * z1 - x1 * z0
  }
  return area / 2
}

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
    samples: Sample[] = [],
    points: [number, number][] = [],
    rim: TerrainHoleRim[] = []
  const edges: [number, number, number, number][] = cutouts.flatMap(({ outer, holes: inner }) =>
    [outer, ...inner].flatMap((ring) =>
      ring.map(([x, z], i) => {
        const [nx, nz] = ring[(i + 1) % ring.length] as [number, number]
        return [x, z, nx, nz] as [number, number, number, number]
      }),
    ),
  )
  const onCutout = (x: number, z: number) =>
    edges.some(([x0, z0, x1, z1]) => {
      const dx = x1 - x0
      const dz = z1 - z0
      const length2 = dx * dx + dz * dz
      const t =
        length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / length2))
      return Math.hypot(x - x0 - t * dx, z - z0 - t * dz) <= ON_EDGE_M
    })
  for (let i = 0; i < buffers.indices.length; i += 3) {
    const source = Array.from(buffers.indices.subarray(i, i + 3))
    const triangle: Ring = source.map((id) => [
      buffers.positions[id * 3]!,
      buffers.positions[id * 3 + 2]!,
    ])
    const xs = triangle.map(([x]) => x),
      zs = triangle.map(([, z]) => z)
    // A triangle only touching a hole is clipped too: its edge on the hole's is the cut edge.
    if (
      !bounds.some(
        (box) =>
          box.maxX >= Math.min(...xs) - ON_EDGE_M &&
          box.minX <= Math.max(...xs) + ON_EDGE_M &&
          box.maxZ >= Math.min(...zs) - ON_EDGE_M &&
          box.minZ <= Math.max(...zs) + ON_EDGE_M,
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
        points.push([x, z])
      }
      for (const [a, b, c] of ShapeUtils.triangulateShape(contour, voids))
        indices.push(offset + c!, offset + b!, offset + a!)
      let first = offset
      for (const [ringIndex, ring] of [polygon.outer, ...polygon.holes].entries()) {
        const area = signedArea(ring)
        // The kept ground is inside an outer ring and outside a void.
        const keptLeft = ringIndex === 0 ? area > 0 : area < 0
        for (let j = 0; j < ring.length; j++) {
          const next = (j + 1) % ring.length
          const [x0, z0] = ring[j] as [number, number]
          const [x1, z1] = ring[next] as [number, number]
          if (Math.hypot(x1 - x0, z1 - z0) < ON_EDGE_M || !onCutout((x0 + x1) / 2, (z0 + z1) / 2))
            continue
          rim.push(keptLeft ? { a: first + j, b: first + next } : { a: first + next, b: first + j })
        }
        first += ring.length
      }
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
  const boundary = { geometry, samples, points, rim }
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
