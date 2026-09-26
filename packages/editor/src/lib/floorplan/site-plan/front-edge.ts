/**
 * The street-facing lot edge from the mapped roads. Pure: no store, no
 * network.
 *
 * For every lot edge, score how well a road fronts it:
 *   1. PARALLELISM — the edge direction must be within `FRONT_EDGE_PARALLEL_DEG`
 *      of the nearest road segment (streets run ALONG a frontage; a road
 *      perpendicular to an edge is rejected).
 *   2. OUTSIDE — the nearest road point must sit on the OUTWARD side of the
 *      edge: the street is off the lot, not a driveway cutting through it.
 *   3. DISTANCE — among edges that pass, the smallest edge-midpoint-to-road
 *      distance wins (the closest fronting street); edges within
 *      `FRONT_EDGE_DISTANCE_TIE_M` of each other are a tie, and the LONGER
 *      edge takes it — a sliver left by a curb return or a split frontage
 *      never beats the frontage it sits beside.
 * CORNER AND THROUGH LOTS: when the address's street matches a road, edges
 * fronting THAT road are preferred over a merely-closer other street — the
 * addressed street is the true front. The match keeps the street type and
 * the directional (street-name.ts, USPS Pub. 28): "NW 34th St" is not
 * "NW 34th Terrace".
 *
 * Coordinates are the site plan frame (metres, x east, y south), the frame
 * the lot polygon and the OSM roads share.
 */
import { edgeLength, outwardNormal, type Pt } from './geometry'
import { parseStreetName, sameStreet } from './street-name'

export interface RoadCenterline {
  name?: string
  centerline: readonly Pt[]
}

export interface FrontEdgeMatch {
  /** Lot edge index: the edge runs from `points[index]` to `points[index + 1]`. */
  index: number
  /** Edge midpoint to the road centerline, metres. */
  distance: number
  /** The fronting road's name ('' when OSM has none). */
  name: string
  /** True when the road is the address's street — name, type and directional (corner / through-lot rule). */
  named: boolean
  /** Every lot edge a street runs along (parallel, outside, within 25 m): a corner lot lists two or more. */
  streetEdges?: number[]
  /** The street each of those edges runs along (the nearest road's name), by edge index; unnamed roads are left out. */
  streetNames?: Record<string, string>
}

export const FRONT_EDGE_PARALLEL_DEG = 30
export const FRONT_EDGE_DISTANCE_TIE_M = 1.5

/** `next` beats `best` when it is clearly nearer, or as near and longer. */
function better(
  next: FrontEdgeMatch & { length: number },
  best: (FrontEdgeMatch & { length: number }) | null,
): boolean {
  if (!best) return true
  if (next.distance < best.distance - FRONT_EDGE_DISTANCE_TIE_M) return true
  if (next.distance > best.distance + FRONT_EDGE_DISTANCE_TIE_M) return false
  return next.length > best.length
}

/**
 * Core street name: the house number, the directionals and the street type
 * dropped — "2600 Castro Way" ↔ OSM "Castro Way" ↔ "S Castro"; OSM spells
 * the quadrant out ("Northeast 109th Street" ↔ "NE 109th St"). The core
 * alone does not say two lines are one street: `sameStreet` also compares
 * the type and the directional.
 */
export function streetCore(s: string | null | undefined): string {
  return parseStreetName(s).name
}

/** The winning lot-edge index with its road, or null (keep the current / fallback edge). */
export function detectFrontEdgeFromRoads(
  lot: readonly Pt[],
  roads: readonly RoadCenterline[],
  addressStreet?: string | null,
): FrontEdgeMatch | null {
  const n = lot.length
  if (n < 3 || roads.length === 0) return null
  const sinLimit = Math.sin((FRONT_EDGE_PARALLEL_DEG * Math.PI) / 180)
  const want = parseStreetName(addressStreet)
  let best: (FrontEdgeMatch & { length: number }) | null = null
  let bestNamed: (FrontEdgeMatch & { length: number }) | null = null
  const streetEdges: number[] = []
  const streetNames: Record<string, string> = {}

  for (let i = 0; i < n; i++) {
    const a = lot[i] as Pt
    const b = lot[(i + 1) % n] as Pt
    const len = edgeLength(lot, i)
    if (len < 0.05) continue
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const ex = (b[0] - a[0]) / len
    const ey = (b[1] - a[1]) / len
    const [nx, ny] = outwardNormal(lot, i)

    // nearest road segment to this edge's midpoint, across every centerline
    let near = Number.POSITIVE_INFINITY
    let nearPt: Pt | null = null
    let nearDir: Pt | null = null
    let nearName = ''
    for (const road of roads) {
      const cl = road.centerline
      for (let k = 0; k + 1 < cl.length; k++) {
        const s0 = cl[k] as Pt
        const s1 = cl[k + 1] as Pt
        const dx = s1[0] - s0[0]
        const dy = s1[1] - s0[1]
        const dd = dx * dx + dy * dy
        if (dd < 1e-12) continue
        const t = Math.max(0, Math.min(1, ((mid[0] - s0[0]) * dx + (mid[1] - s0[1]) * dy) / dd))
        const foot: Pt = [s0[0] + dx * t, s0[1] + dy * t]
        const d = Math.hypot(mid[0] - foot[0], mid[1] - foot[1])
        if (d < near) {
          near = d
          nearPt = foot
          const sl = Math.sqrt(dd)
          nearDir = [dx / sl, dy / sl]
          nearName = road.name ?? ''
        }
      }
    }
    if (!nearPt || !nearDir) continue
    // (1) parallel: |sin(angle between the edge and the road)| small
    const sinAng = Math.abs(ex * nearDir[1] - ey * nearDir[0])
    if (sinAng > sinLimit) continue
    // (2) outside: the road lies on the outward side of the edge
    if ((nearPt[0] - mid[0]) * nx + (nearPt[1] - mid[1]) * ny <= 0) continue

    // a street runs along this edge (a corner lot collects two or more)
    if (near <= 25 && len >= 3) {
      streetEdges.push(i)
      if (nearName) streetNames[String(i)] = nearName
    }
    const match = { index: i, distance: near, name: nearName, named: false, length: len }
    if (better(match, best)) best = match
    if (sameStreet(want, nearName) && better(match, bestNamed)) {
      bestNamed = { ...match, named: true }
    }
  }
  const pick = bestNamed ?? best
  return pick
    ? {
        index: pick.index,
        distance: pick.distance,
        name: pick.name,
        named: pick.named,
        streetEdges: streetEdges.includes(pick.index) ? streetEdges : [pick.index, ...streetEdges],
        streetNames:
          pick.name && !streetNames[String(pick.index)]
            ? { ...streetNames, [String(pick.index)]: pick.name }
            : streetNames,
      }
    : null
}
