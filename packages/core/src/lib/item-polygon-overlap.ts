import { pointInPolygon } from '../systems/slab/slab-support'
import { planFootprintCorners } from './plan-footprint'

/**
 * Test if two line segments (a1->a2) and (b1->b2) intersect.
 */
function segmentsIntersect(
  ax1: number,
  az1: number,
  ax2: number,
  az2: number,
  bx1: number,
  bz1: number,
  bx2: number,
  bz2: number,
): boolean {
  const cross = (ox: number, oz: number, ax: number, az: number, bx: number, bz: number) =>
    (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)

  const d1 = cross(bx1, bz1, bx2, bz2, ax1, az1)
  const d2 = cross(bx1, bz1, bx2, bz2, ax2, az2)
  const d3 = cross(ax1, az1, ax2, az2, bx1, bz1)
  const d4 = cross(ax1, az1, ax2, az2, bx2, bz2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Collinear touching cases
  const onSeg = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    Math.min(px, qx) <= rx &&
    rx <= Math.max(px, qx) &&
    Math.min(pz, qz) <= rz &&
    rz <= Math.max(pz, qz)

  if (d1 === 0 && onSeg(bx1, bz1, bx2, bz2, ax1, az1)) return true
  if (d2 === 0 && onSeg(bx1, bz1, bx2, bz2, ax2, az2)) return true
  if (d3 === 0 && onSeg(ax1, az1, ax2, az2, bx1, bz1)) return true
  if (d4 === 0 && onSeg(ax1, az1, ax2, az2, bx2, bz2)) return true

  return false
}

/**
 * Test if a line segment intersects any edge of a polygon.
 */
function segmentIntersectsPolygon(
  sx1: number,
  sz1: number,
  sx2: number,
  sz2: number,
  polygon: Array<[number, number]>,
): boolean {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (
      segmentsIntersect(
        sx1,
        sz1,
        sx2,
        sz2,
        polygon[i]![0],
        polygon[i]![1],
        polygon[j]![0],
        polygon[j]![1],
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Test if an item's footprint overlaps with a polygon.
 * Checks: any item corner inside polygon, or any polygon vertex inside item AABB, or edges intersect.
 */
export function itemOverlapsPolygon(
  position: [number, number, number],
  dimensions: [number, number, number],
  rotation: [number, number, number],
  polygon: Array<[number, number]>,
  inset = 0,
): boolean {
  const corners = planFootprintCorners(position, dimensions, rotation[1], inset)

  // Check if any item corner is inside the polygon
  for (const [cx, cz] of corners) {
    if (pointInPolygon(cx, cz, polygon)) return true
  }

  // Check if any polygon vertex is inside the item footprint
  // (handles case where slab is fully inside a large item)
  for (const [px, pz] of polygon) {
    if (pointInPolygon(px, pz, corners)) return true
  }

  // Check if any item edge intersects any polygon edge
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    if (
      segmentIntersectsPolygon(
        corners[i]![0],
        corners[i]![1],
        corners[j]![0],
        corners[j]![1],
        polygon,
      )
    )
      return true
  }

  return false
}
