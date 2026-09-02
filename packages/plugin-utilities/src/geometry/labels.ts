/**
 * Label placement along a plan polyline.
 *
 * Two shapes of tag are drawn on utility runs:
 *   - underground: the system letter (E/S/W/G/T/D) REPEATED along the run at
 *     a fixed spacing, the civil-plan convention;
 *   - overhead: a single `— OH —` tag at the middle of the longest span.
 *
 * `spacedLabelPoints` is the shared primitive: walk the polyline by arc
 * length and emit a point + tangent every `spacing` metres, inset from both
 * ends by `margin` so a tag never lands on a joint or a symbol.
 */

export type PlanPoint = [number, number]

export type LabelSite = {
  /** Plan position of the tag. */
  point: PlanPoint
  /** Unit tangent of the run there — the tag's baseline direction. */
  tangent: PlanPoint
  /** Distance along the run, metres. */
  distance: number
}

/** Cumulative arc length of a plan polyline. */
export function planLength(points: readonly PlanPoint[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as PlanPoint
    const b = points[i + 1] as PlanPoint
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

/** Point + tangent at arc-length `distance` along a plan polyline. */
export function pointAtDistance(
  points: readonly PlanPoint[],
  distance: number,
): LabelSite | null {
  if (points.length < 2) return null
  let remaining = Math.max(0, distance)
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as PlanPoint
    const b = points[i + 1] as PlanPoint
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (segment <= 1e-9) continue
    if (remaining <= segment) {
      const t = remaining / segment
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        tangent: [(b[0] - a[0]) / segment, (b[1] - a[1]) / segment],
        distance,
      }
    }
    remaining -= segment
  }
  const last = points[points.length - 1] as PlanPoint
  const prev = points[points.length - 2] as PlanPoint
  const segment = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1
  return {
    point: [last[0], last[1]],
    tangent: [(last[0] - prev[0]) / segment, (last[1] - prev[1]) / segment],
    distance: planLength(points),
  }
}

/**
 * Evenly spaced label sites along a polyline.
 *
 * The tags are CENTRED on the run: the first tag sits half a leftover
 * spacing past the margin, so a run that is not an exact multiple of
 * `spacing` gets equal blank ends rather than a long gap at the finish.
 * A run shorter than `2·margin + spacing` gets exactly one tag at its
 * midpoint (never zero — an untagged utility line is unreadable), and a run
 * of zero length gets none.
 */
export function spacedLabelPoints(
  points: readonly PlanPoint[],
  spacing: number,
  margin = 0,
): LabelSite[] {
  const total = planLength(points)
  if (points.length < 2 || total <= 1e-9 || !(spacing > 0)) return []
  const usable = total - margin * 2
  if (usable <= spacing) {
    const mid = pointAtDistance(points, total / 2)
    return mid ? [mid] : []
  }
  const count = Math.floor(usable / spacing) + 1
  const span = (count - 1) * spacing
  const start = margin + (usable - span) / 2
  const sites: LabelSite[] = []
  for (let i = 0; i < count; i++) {
    const site = pointAtDistance(points, start + i * spacing)
    if (site) sites.push(site)
  }
  return sites
}

/** Midpoint of the longest segment — where a single run tag reads best. */
export function longestSegmentMidpoint(points: readonly PlanPoint[]): LabelSite | null {
  if (points.length < 2) return null
  let best = -1
  let bestStart = 0
  let travelled = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as PlanPoint
    const b = points[i + 1] as PlanPoint
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (segment > best) {
      best = segment
      bestStart = travelled
    }
    travelled += segment
  }
  if (best <= 0) return null
  return pointAtDistance(points, bestStart + best / 2)
}
