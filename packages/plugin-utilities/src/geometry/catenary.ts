/**
 * Overhead-span sag geometry.
 *
 * A conductor hanging under its own weight is a CATENARY,
 *   y(x) = a·cosh(x / a) − a,
 * with `a = H / w` (horizontal tension over weight per unit length). We do
 * not know H or w from the scene, so the drawing is driven the other way
 * round: the user gives a mid-span sag as a fraction of the span
 * (`sagRatio`, default 1.5%), and `catenaryParameterForSag` solves for the
 * `a` that produces exactly that sag. The curve is then the true catenary
 * shape for that sag — not a parabola — so a long span visibly differs from
 * a short one.
 *
 * This is DRAWING geometry only. Real sag depends on tension, conductor
 * weight, span and temperature, and NESC (ANSI C2) governs the resulting
 * ground clearance. Nothing here checks a clearance.
 */

export type Vec3 = [number, number, number]

/**
 * Solve `a` in `a·(cosh(L / (2a)) − 1) = sag` for a span `L` and mid-span
 * `sag`. Bisection on `u = L / (2a)`: the sag/span ratio
 *   f(u) = (cosh(u) − 1) / (2u)
 * is continuous and strictly increasing on u > 0 from 0 to ∞, so a ratio in
 * (0, ∞) has exactly one root. Returns `Infinity` for a zero sag (a straight
 * line is the a → ∞ limit).
 */
export function catenaryParameterForSag(span: number, sag: number): number {
  if (!(span > 0) || !(sag > 0)) return Number.POSITIVE_INFINITY
  const target = sag / span
  const f = (u: number) => (Math.cosh(u) - 1) / (2 * u)
  let lo = 1e-6
  let hi = 1
  // Expand until f(hi) brackets the target (f grows without bound).
  for (let i = 0; i < 200 && f(hi) < target; i++) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < target) lo = mid
    else hi = mid
  }
  const u = (lo + hi) / 2
  return span / (2 * u)
}

/**
 * Mid-span drop of the catenary with parameter `a` over a span `L`:
 * `a·(cosh(L / 2a) − 1)`. The inverse of `catenaryParameterForSag`.
 */
export function catenarySag(span: number, a: number): number {
  if (!Number.isFinite(a) || a <= 0 || !(span > 0)) return 0
  return a * (Math.cosh(span / (2 * a)) - 1)
}

/**
 * Sample one sagged span between two 3D points.
 *
 * The chord may be inclined (a pole top down to a service head): the sag is
 * applied as a VERTICAL drop measured from the straight chord, which is the
 * standard level-span approximation and keeps both endpoints exactly on
 * their attachments. `segments` is the number of sub-segments, so the
 * returned array has `segments + 1` points, first and last equal to the
 * inputs.
 */
export function sampleCatenarySpan(
  from: Vec3,
  to: Vec3,
  sagRatio: number,
  segments = 24,
): Vec3[] {
  const steps = Math.max(1, Math.floor(segments))
  const span = Math.hypot(to[0] - from[0], to[2] - from[2])
  const sag = span * Math.max(0, sagRatio)
  const a = catenaryParameterForSag(span, sag)
  const points: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from[0] + (to[0] - from[0]) * t
    const z = from[2] + (to[2] - from[2]) * t
    const chordY = from[1] + (to[1] - from[1]) * t
    let drop = 0
    if (Number.isFinite(a) && a > 0 && span > 0) {
      // Local horizontal coordinate measured from mid-span.
      const s = (t - 0.5) * span
      // cosh at the ends is cosh(L/2a); subtracting keeps the drop 0 there.
      drop = a * (Math.cosh(span / (2 * a)) - Math.cosh(s / a))
    }
    points.push([x, chordY - drop, z])
  }
  return points
}

/** Sample every span of a multi-vertex overhead run, without duplicating joints. */
export function sampleOverheadPath(
  path: readonly Vec3[],
  sagRatio: number,
  segmentsPerSpan = 24,
): Vec3[] {
  if (path.length < 2) return path.map((p) => [...p] as Vec3)
  const out: Vec3[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const span = sampleCatenarySpan(path[i] as Vec3, path[i + 1] as Vec3, sagRatio, segmentsPerSpan)
    out.push(...(i === 0 ? span : span.slice(1)))
  }
  return out
}

/** Total 3D length of a polyline, metres. */
export function polylineLength(path: readonly Vec3[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Vec3
    const b = path[i + 1] as Vec3
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/**
 * Length of a run as it should be reported: the SAGGED length for overhead
 * (the cable is longer than the chord), the straight polyline length for
 * underground.
 */
export function runLength(
  path: readonly Vec3[],
  routing: 'overhead' | 'underground',
  sagRatio: number,
): number {
  if (path.length < 2) return 0
  if (routing === 'underground') return polylineLength(path)
  return polylineLength(sampleOverheadPath(path, sagRatio, 48))
}
