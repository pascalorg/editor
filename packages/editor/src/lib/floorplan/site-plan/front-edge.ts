/**
 * The street-facing lot edge from the mapped roads — PlanCrafters'
 * `SITE.detectFrontEdge` (site.js), ported. Pure: no store, no network.
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
 * CORNER LOTS: when the address's street name matches a road name, edges
 * fronting THAT road are preferred over a merely-closer cross street — the
 * addressed street is the true front.
 *
 * Coordinates are the site plan frame (metres, x east, y south), the frame
 * the lot polygon and the OSM roads share.
 */
import { edgeLength, outwardNormal, type Pt } from './geometry'

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
  /** True when the road's name matched the address's street (corner-lot rule). */
  named: boolean
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
 * Core street name: drop the house number, a leading / trailing direction
 * and the street-type suffix so "2600 Castro Way" ↔ OSM "Castro Way" ↔
 * "S Castro".
 */
export function streetCore(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s+/, '')
    .replace(/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)\s+/, '')
    .replace(/\s+(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/, '')
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|place|pl|boulevard|blvd|circle|cir|terrace|ter|trail|trl|parkway|pkwy|highway|hwy|route|rte)\b\.?/g,
      '',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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
  const want = streetCore(addressStreet)
  let best: (FrontEdgeMatch & { length: number }) | null = null
  let bestNamed: (FrontEdgeMatch & { length: number }) | null = null

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

    const match = { index: i, distance: near, name: nearName, named: false, length: len }
    if (better(match, best)) best = match
    if (want && streetCore(nearName) === want && better(match, bestNamed)) {
      bestNamed = { ...match, named: true }
    }
  }
  const pick = bestNamed ?? best
  return pick
    ? { index: pick.index, distance: pick.distance, name: pick.name, named: pick.named }
    : null
}
