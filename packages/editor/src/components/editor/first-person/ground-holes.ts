/**
 * Holes in the site ground's collision geometry.
 *
 * The walkthrough stands on one merged BVH mesh, and the site's ground (a flat slab, or the terrain)
 * is a sheet across the whole lot. Where the house stands over a basement the ground is drawn open
 * (`coveredBelowGradeFootprints`), but the sheet under the stairwell stayed: the player descending
 * the stair met it at grade and could go no deeper. Cutting the collider by the same rings the
 * ground is drawn open over lets the player follow the building's floors and stairs there.
 *
 * Every triangle that reaches a hole is cut against it in plan; the pieces keep the source
 * triangle's plane (height and normal interpolated from its corners) and its facing, so the cut
 * surface is exactly the one the uncut triangle was.
 */

import { difference, type Ring, union } from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three'

/** Triangles flatter than this in plan (m²) are vertical faces: they hold nothing up. */
const MIN_PLAN_AREA = 1e-9

type Corner = { x: number; y: number; z: number; nx: number; ny: number; nz: number }

/** Twice the signed plan area of `a b c` (x right, z down). */
function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/**
 * `geometry` (non-indexed, `position` and `normal`, in the frame the rings are in) without the part
 * of it that lies over `holes`. A triangle the clip fails on is kept whole: the ground closed is
 * the safe side. The geometry is returned as it is when there are no holes.
 */
export function cutGroundCollider(
  geometry: BufferGeometry,
  holes: readonly Ring[],
): BufferGeometry {
  if (holes.length === 0) return geometry
  const cutouts = union(holes)
  if (cutouts.length === 0) return geometry
  const boxes = cutouts.map(({ outer }) => ({
    minX: Math.min(...outer.map(([x]) => x)),
    maxX: Math.max(...outer.map(([x]) => x)),
    minZ: Math.min(...outer.map(([, z]) => z)),
    maxZ: Math.max(...outer.map(([, z]) => z)),
  }))

  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const positions: number[] = []
  const normals: number[] = []
  const push = (corner: Corner) => {
    positions.push(corner.x, corner.y, corner.z)
    normals.push(corner.nx, corner.ny, corner.nz)
  }

  for (let i = 0; i + 2 < position.count; i += 3) {
    const corners: Corner[] = [0, 1, 2].map((k) => ({
      x: position.getX(i + k),
      y: position.getY(i + k),
      z: position.getZ(i + k),
      nx: normal.getX(i + k),
      ny: normal.getY(i + k),
      nz: normal.getZ(i + k),
    }))
    const [a, b, c] = corners as [Corner, Corner, Corner]
    const minX = Math.min(a.x, b.x, c.x)
    const maxX = Math.max(a.x, b.x, c.x)
    const minZ = Math.min(a.z, b.z, c.z)
    const maxZ = Math.max(a.z, b.z, c.z)
    const reached = boxes.some(
      (box) => box.maxX > minX && box.minX < maxX && box.maxZ > minZ && box.minZ < maxZ,
    )
    const plan: [[number, number], [number, number], [number, number]] = [
      [a.x, a.z],
      [b.x, b.z],
      [c.x, c.z],
    ]
    const determinant = orient(plan[0], plan[1], plan[2])
    if (!reached || Math.abs(determinant) < MIN_PLAN_AREA) {
      corners.forEach(push)
      continue
    }

    let pieces: ReturnType<typeof difference>
    try {
      pieces = difference(plan, cutouts, { throwOnError: true })
    } catch {
      corners.forEach(push)
      continue
    }

    const at = (x: number, z: number): Corner => {
      const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / determinant
      const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / determinant
      const wc = 1 - wa - wb
      const nx = a.nx * wa + b.nx * wb + c.nx * wc
      const ny = a.ny * wa + b.ny * wb + c.ny * wc
      const nz = a.nz * wa + b.nz * wb + c.nz * wc
      const length = Math.hypot(nx, ny, nz) || 1
      return {
        x,
        y: a.y * wa + b.y * wb + c.y * wc,
        z,
        nx: nx / length,
        ny: ny / length,
        nz: nz / length,
      }
    }

    for (const piece of pieces) {
      const rings = [piece.outer, ...piece.holes]
      const points = rings.flat()
      const contour = piece.outer.map(([x, z]) => new Vector2(x, z))
      const voids = piece.holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)))
      for (const [p, q, r] of ShapeUtils.triangulateShape(contour, voids)) {
        const corner = [p, q, r].map((index) => points[index as number] as [number, number])
        const swap =
          Math.sign(orient(corner[0]!, corner[1]!, corner[2]!)) !== Math.sign(determinant)
        const ordered = swap ? [corner[0]!, corner[2]!, corner[1]!] : corner
        for (const [x, z] of ordered) push(at(x, z))
      }
    }
  }

  const cut = new BufferGeometry()
  cut.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  cut.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.dispose()
  return cut
}
