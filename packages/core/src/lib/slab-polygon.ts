import type { SlabNode } from '../schema'
import { insetPolygonFromCentroid, simplifyClosedPolygon } from './polygon-geometry'

/** Half of default wall thickness — used to extend slab geometry under walls */
const SLAB_OUTSET = 0.05
const AUTO_SLAB_INSET = 0.02
const AUTO_SLAB_SIMPLIFY_TOLERANCE = 0.08

export function getRenderableSlabPolygon(slabNode: SlabNode): Array<[number, number]> {
  return slabNode.autoFromWalls
    ? simplifyClosedPolygon(
        insetPolygonFromCentroid(slabNode.polygon, AUTO_SLAB_INSET),
        AUTO_SLAB_SIMPLIFY_TOLERANCE,
      )
    : outsetPolygon(slabNode.polygon, SLAB_OUTSET)
}

/**
 * Expand a polygon outward by a uniform distance.
 * Offsets each edge outward then intersects consecutive offset edges.
 */
function outsetPolygon(polygon: Array<[number, number]>, amount: number): Array<[number, number]> {
  const n = polygon.length
  if (n < 3) return polygon

  // Determine winding via signed area
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area2 += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1]
  }
  const s = area2 >= 0 ? 1 : -1

  // Offset each edge outward by amount
  const offEdges: Array<[number, number, number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = polygon[j]![0] - polygon[i]![0]
    const dz = polygon[j]![1] - polygon[i]![1]
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len < 1e-9) {
      offEdges.push([polygon[i]![0], polygon[i]![1], dx, dz])
      continue
    }
    const nx = ((s * dz) / len) * amount
    const nz = ((s * -dx) / len) * amount
    offEdges.push([polygon[i]![0] + nx, polygon[i]![1] + nz, dx, dz])
  }

  // Intersect consecutive offset edges to get new vertices
  const result: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [ax, az, adx, adz] = offEdges[i]!
    const [bx, bz, bdx, bdz] = offEdges[j]!
    const denom = adx * bdz - adz * bdx
    if (Math.abs(denom) < 1e-9) {
      // Parallel edges — use offset endpoint
      result.push([ax + adx, az + adz])
    } else {
      const t = ((bx - ax) * bdz - (bz - az) * bdx) / denom
      result.push([ax + t * adx, az + t * adz])
    }
  }

  return result
}
