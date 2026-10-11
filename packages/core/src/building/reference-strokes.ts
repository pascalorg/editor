import type { ReferencePoint as PlanPoint } from './reference-transform'

/** Offset an open SVG stroke without closing its centreline into an invented wall. */
export function strokeFootprint(points: PlanPoint[], width: number): PlanPoint[] {
  if (points.length < 2 || !Number.isFinite(width) || width <= 0) return []
  const normals = points.slice(1).map((b, i): PlanPoint => {
    const a = points[i]!,
      length = Math.hypot(b[0] - a[0], b[1] - a[1])
    return length ? [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] : [0, 0]
  })
  const side = (sign: number) =>
    points.flatMap((p, i): PlanPoint[] => {
      const a = normals[Math.max(0, i - 1)]!,
        b = normals[Math.min(i, normals.length - 1)]!
      const denominator = 1 + a[0] * b[0] + a[1] * b[1]
      const offset: PlanPoint =
        denominator > 0.001
          ? [(a[0] + b[0]) / denominator, (a[1] + b[1]) / denominator]
          : [Infinity, Infinity]
      // Bevel tight turns instead of producing arbitrarily long miters.
      const offsets = Math.hypot(...offset) <= 4 ? [offset] : [a, b]
      return offsets.map((n) => [
        p[0] + (n[0] * width * sign) / 2,
        p[1] + (n[1] * width * sign) / 2,
      ])
    })
  return [...side(1), ...side(-1).reverse()]
}
