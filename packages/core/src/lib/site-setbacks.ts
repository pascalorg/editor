import type { SetbackRule, SiteNode } from '../schema/nodes/site'
import { type Point2D, polygonArea } from './polygon-relations'
import { buildableArea, resolveSetbackDistances, sumRingAreas } from './setback-offset'

/**
 * Common Turkish practice, and nothing more than that: 5 m to the road, 3 m to
 * each neighbour. Local development plans override them freely, so these are an
 * editable starting point the panel says out loud is not binding — never a
 * number the app applies on the user's behalf.
 *
 * Storey-count adjustments (the +0.50 m per floor some plans add to a side
 * yard) are deliberately absent: a plan can overrule the rule itself, and a
 * wrong automatic number is more dangerous than a wrong typed one, because
 * nobody re-checks a figure the software looked confident about.
 */
export const SETBACK_ROLE_PRESETS: Record<SetbackRule['role'], number> = {
  road: 5,
  side: 3,
  rear: 3,
}

export type SiteBuildableReading = {
  /** Per-edge setback in metres, dense and aligned with the polygon's edges. */
  distances: number[]
  /** Zero rings is a real answer: the setbacks leave nowhere to build. */
  rings: Point2D[][]
  buildableArea: number
  parcelArea: number
  /** False when every edge is at zero — the overlay would just retrace the lot line. */
  hasSetback: boolean
}

/**
 * What the panel prints and both overlays draw, derived from the node alone.
 *
 * Derived rather than stored on purpose: the polygon moves under a vertex drag,
 * and a persisted buildable ring would go stale behind it. Callers memoise on
 * the points and the setback record.
 */
export function readSiteBuildable(
  points: ReadonlyArray<readonly [number, number]> | undefined,
  site: Pick<SiteNode, 'setbacks' | 'defaultSetback'> | undefined,
): SiteBuildableReading {
  const polygon = (points ?? []).map(([x, z]) => [x, z] as Point2D)
  const distances = resolveSetbackDistances(polygon.length, site?.setbacks, site?.defaultSetback)
  const parcelArea = polygonArea(polygon)
  const hasSetback = distances.some((distance) => distance > 0)

  if (polygon.length < 3 || !hasSetback) {
    return { distances, rings: [], buildableArea: parcelArea, parcelArea, hasSetback }
  }

  const rings = buildableArea(polygon, distances)
  return { distances, rings, buildableArea: sumRingAreas(rings), parcelArea, hasSetback }
}

/** Length of each edge of the ring, edge `i` running `points[i] → points[i + 1]`. */
export function polygonEdgeLengths(
  points: ReadonlyArray<readonly [number, number]> | undefined,
): number[] {
  const ring = points ?? []
  return ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length]!
    return Math.hypot(next[0] - point[0], next[1] - point[1])
  })
}

/** The rule stored for an edge, or the site's fallback spelled out in full. */
export function setbackRuleForEdge(
  site: Pick<SiteNode, 'setbacks' | 'defaultSetback'> | undefined,
  edgeIndex: number,
): SetbackRule {
  const stored = site?.setbacks?.[String(edgeIndex)]
  if (stored) return stored
  return { role: 'side', distance: site?.defaultSetback ?? 0 }
}
