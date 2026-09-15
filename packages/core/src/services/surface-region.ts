import { type Point2D, pointInPolygon, polygonsOverlap } from '../lib/polygon-relations'
import { boxCorners, frame, transformPoint } from '../procedural-items/spatial'
import type { SurfaceRegion } from './surface-hosting'

const EPSILON = 1e-6

function outline(region: SurfaceRegion): Point2D[] {
  if (region.kind === 'polygon') return (region.points ?? []).map(([x, z]) => [x, z])
  if (!region.size) return []
  const [x, z] = region.center ?? [0, 0]
  const [w, d] = region.size
  return [
    [x - w, z - d],
    [x + w, z - d],
    [x + w, z + d],
    [x - w, z + d],
  ]
}

export function surfaceRegionContainsPoint(
  region: SurfaceRegion | undefined,
  point: readonly [number, number],
): boolean {
  if (!region) return true
  return (
    pointInPolygon([...point], outline(region)) &&
    !(region.holes ?? []).some((hole) =>
      pointInPolygon(
        [...point],
        hole.map(([x, z]) => [x, z]),
      ),
    )
  )
}

function crossesInterior(a: Point2D, b: Point2D, footprint: Point2D[]): boolean {
  let enter = 0
  let exit = 1
  for (let i = 0; i < footprint.length; i++) {
    const c = footprint[i]!
    const d = footprint[(i + 1) % footprint.length]!
    const length = Math.hypot(d[0] - c[0], d[1] - c[1])
    if (length === 0) return false
    const distance = (p: Point2D) =>
      ((d[0] - c[0]) * (p[1] - c[1]) - (d[1] - c[1]) * (p[0] - c[0])) / length - EPSILON
    const start = distance(a)
    const end = distance(b)
    if (start <= 0 && end <= 0) return false
    if (start <= 0) enter = Math.max(enter, -start / (end - start))
    else if (end <= 0) exit = Math.min(exit, start / (start - end))
    if (enter >= exit) return false
  }
  return enter < exit
}

function projectedHull(points: Point2D[]): Point2D[] {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (input: Point2D[]) => {
    const hull: Point2D[] = []
    for (const p of input) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2]!
        const b = hull[hull.length - 1]!
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) break
        hull.pop()
      }
      hull.push(p)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** Position and XYZ rotation are surface-local; bounds and size are scaled child-local values. */
export function surfaceRegionContainsFootprint(
  region: SurfaceRegion | undefined,
  position: readonly [number, number, number],
  size: readonly [number, number, number],
  rotation: number | readonly [number, number, number],
  localBounds?: { min: readonly [number, number, number]; max: readonly [number, number, number] },
): boolean {
  if (!region) return true
  const bounds = localBounds ?? {
    min: [-size[0] / 2, 0, -size[2] / 2],
    max: [size[0] / 2, size[1], size[2] / 2],
  }
  const childFrame = frame(
    [...position],
    typeof rotation === 'number' ? [0, rotation, 0] : [...rotation],
  )
  const footprint = projectedHull(
    boxCorners(
      [bounds.min[0]!, bounds.min[1]!, bounds.min[2]!],
      [bounds.max[0]!, bounds.max[1]!, bounds.max[2]!],
    ).map((p) => {
      const point = transformPoint(childFrame, p)
      return [point[0], point[2]]
    }),
  )
  if (region.kind === 'rect') {
    if (!region.size) return false
    const [x, z] = region.center ?? [0, 0]
    if (
      footprint.some(
        (p) =>
          Math.abs(p[0] - x) > region.size![0] + EPSILON ||
          Math.abs(p[1] - z) > region.size![1] + EPSILON,
      )
    )
      return false
  } else {
    const outer = outline(region)
    if (!footprint.every((p) => pointInPolygon(p, outer))) return false
    // Corners alone miss a concave notch crossing the footprint's interior.
    if (outer.some((a, i) => crossesInterior(a, outer[(i + 1) % outer.length]!, footprint)))
      return false
  }
  return !(region.holes ?? []).some((hole) =>
    polygonsOverlap(
      hole.map(([x, z]) => [x, z]),
      footprint,
    ),
  )
}
