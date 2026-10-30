import type { FoundationMember } from '@pascal-app/core'

/** The foundation members of one kind as one indexed mesh, in world coordinates. */
export type FoundationMesh = {
  positions: Float32Array
  normals: Float32Array
  /** Metres along the run, for the courses of block to bond along the wall. */
  along: Float32Array
  indices: Uint32Array
}

type Vec3 = readonly [number, number, number]

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * The runs of `kind` as closed boxes, six faces each with its own flat normal. A run is a prism on
 * the plan line `from` to `to`, `width` across, from `bottomY` to `topY`. Corners are closed by the
 * runs themselves (they overlap), so the boxes carry no joins.
 */
export function buildFoundationMesh(
  members: readonly FoundationMember[],
  kind: FoundationMember['kind'],
): FoundationMesh | null {
  const runs = members.filter((member) => member.kind === kind)
  if (runs.length === 0) return null
  const positions: number[] = []
  const normals: number[] = []
  const along: number[] = []
  const indices: number[] = []

  const quad = (corners: [Vec3, Vec3, Vec3, Vec3], outward: Vec3, alongAt: number[]) => {
    const [a, b, c] = corners
    const facing = dot(cross(sub(b, a), sub(c, a)), outward) >= 0
    const order = facing ? [0, 1, 2, 3] : [0, 3, 2, 1]
    const base = positions.length / 3
    for (const index of order) {
      positions.push(...(corners[index] as Vec3))
      normals.push(...outward)
      along.push(alongAt[index] as number)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  for (const { from, to, width, bottomY, topY } of runs) {
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const length = Math.hypot(dx, dz)
    if (length < 1e-9 || topY - bottomY < 1e-9) continue
    const [ux, uz] = [dx / length, dz / length]
    const [nx, nz] = [-uz, ux]
    const half = width / 2
    const at = (end: [number, number], side: number, y: number): Vec3 => [
      end[0] + nx * half * side,
      y,
      end[1] + nz * half * side,
    ]
    const [a0, a1, a2, a3] = [
      at(from, 1, bottomY),
      at(to, 1, bottomY),
      at(to, -1, bottomY),
      at(from, -1, bottomY),
    ]
    const [b0, b1, b2, b3] = [
      at(from, 1, topY),
      at(to, 1, topY),
      at(to, -1, topY),
      at(from, -1, topY),
    ]
    const run = [0, length, length, 0]
    quad([b0, b1, b2, b3], [0, 1, 0], run)
    quad([a0, a1, a2, a3], [0, -1, 0], run)
    quad([a0, a1, b1, b0], [nx, 0, nz], [0, length, length, 0])
    quad([a3, a2, b2, b3], [-nx, 0, -nz], [0, length, length, 0])
    quad([a0, a3, b3, b0], [-ux, 0, -uz], [0, 0, 0, 0])
    quad([a1, a2, b2, b1], [ux, 0, uz], [length, length, length, length])
  }
  if (indices.length === 0) return null
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    along: new Float32Array(along),
    indices: new Uint32Array(indices),
  }
}
