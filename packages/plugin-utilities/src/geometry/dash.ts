import type { Vec3 } from './catenary'

/**
 * Split a 3D polyline into dash intervals.
 *
 * Real dashing, not a dash MATERIAL: each interval becomes its own tube in
 * the renderer, so the dash length stays a metric length at any camera
 * distance (a `LineDashedMaterial` dash is measured in the line's own
 * parameter space and needs `computeLineDistances`, and dashed lines are
 * one-pixel wide regardless of zoom — unusable for a buried service).
 *
 * The pattern runs continuously along the whole polyline, so a dash spans a
 * vertex rather than restarting at every corner.
 */
export type DashInterval = { start: Vec3; end: Vec3 }

/** Cumulative length of a 3D polyline. */
export function polylineLength3(points: readonly Vec3[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Vec3
    const b = points[i + 1] as Vec3
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/** Point at arc-length `distance` along a 3D polyline (clamped to its ends). */
export function pointAtDistance3(points: readonly Vec3[], distance: number): Vec3 {
  if (points.length === 0) return [0, 0, 0]
  if (points.length === 1) return [...(points[0] as Vec3)]
  let remaining = Math.max(0, distance)
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Vec3
    const b = points[i + 1] as Vec3
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (segment <= 1e-9) continue
    if (remaining <= segment) {
      const t = remaining / segment
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    }
    remaining -= segment
  }
  return [...(points[points.length - 1] as Vec3)]
}

/**
 * Dash intervals along a polyline. `dash` metres drawn, `gap` metres blank,
 * starting at the run's beginning; the final dash is clipped to the end so
 * the run never overshoots.
 */
export function dashIntervals(
  points: readonly Vec3[],
  dash: number,
  gap: number,
): DashInterval[] {
  const out: DashInterval[] = []
  const period = dash + gap
  const total = polylineLength3(points)
  if (points.length < 2 || total <= 1e-9 || !(dash > 0) || !(period > 0)) return out
  for (let cursor = 0; cursor < total - 1e-9; cursor += period) {
    const end = Math.min(cursor + dash, total)
    if (end - cursor < 1e-6) continue
    out.push({ start: pointAtDistance3(points, cursor), end: pointAtDistance3(points, end) })
  }
  return out
}
