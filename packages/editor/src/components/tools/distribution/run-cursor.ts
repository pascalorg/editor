import type { RunPoint, RunSurfaceFrame } from './distribution-run-contract'

export function intersectRunPlane(
  ray: { origin: RunPoint; direction: RunPoint },
  frame: RunSurfaceFrame,
): RunPoint | null {
  const denominator = ray.direction.reduce((sum, value, i) => sum + value * frame.normal[i]!, 0)
  if (Math.abs(denominator) < 1e-5) return null
  const distance =
    frame.origin.reduce((sum, value, i) => sum + (value - ray.origin[i]!) * frame.normal[i]!, 0) /
    denominator
  if (distance < 0 || !Number.isFinite(distance)) return null
  return ray.origin.map((value, i) => value + distance * ray.direction[i]!) as RunPoint
}

export function resolveRunCursorPlane({
  hit,
  working,
  ray,
  fallback,
  clearance,
}: {
  hit: { point: RunPoint; frame: RunSurfaceFrame } | null
  working: RunSurfaceFrame | null
  ray?: { origin: RunPoint; direction: RunPoint }
  fallback: RunPoint
  clearance: number
}): { point: RunPoint; frame: RunSurfaceFrame } {
  if (hit) {
    const offset = (point: RunPoint): RunPoint =>
      point.map((value, i) => value + hit.frame.normal[i]! * clearance) as RunPoint
    return { point: offset(hit.point), frame: { ...hit.frame, origin: offset(hit.frame.origin) } }
  }
  if (!working) throw new Error('A cursor requires a surface or a working plane')
  return { point: ray ? (intersectRunPlane(ray, working) ?? fallback) : fallback, frame: working }
}
