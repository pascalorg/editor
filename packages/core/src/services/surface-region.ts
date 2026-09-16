import { type Point2D, pointInPolygon } from '../lib/polygon-relations'
import { frame, transformPoint } from '../procedural-items/spatial'
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
    (region.kind === 'rect'
      ? !!region.size &&
        Math.abs(point[0] - (region.center?.[0] ?? 0)) <= region.size[0] + EPSILON &&
        Math.abs(point[1] - (region.center?.[1] ?? 0)) <= region.size[1] + EPSILON
      : pointInPolygon([...point], outline(region))) &&
    !(region.holes ?? []).some((hole) =>
      pointInPolygon(
        [...point],
        hole.map(([x, z]) => [x, z]),
      ),
    )
  )
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
  // A rotated box and its XZ projection are centrally symmetric, so their centre is the transformed bounds midpoint.
  const center = transformPoint(childFrame, [
    (bounds.min[0]! + bounds.max[0]!) / 2,
    (bounds.min[1]! + bounds.max[1]!) / 2,
    (bounds.min[2]! + bounds.max[2]!) / 2,
  ])
  return surfaceRegionContainsPoint(region, [center[0], center[2]])
}
