/**
 * OpenStreetMap roads around a lot — the pure half of PlanCrafters'
 * `osmroads.js` (HA.osmroads): the Overpass query, the highway classes we
 * lay with their default roadway widths, and the parser that turns an
 * Overpass `out geom` answer into centerlines in the site plan frame
 * (origin = the geocoded point, x east, z south, METRES — the frame the
 * site polygon is stored in, so roads and lot line up without a transform).
 *
 * The network call lives in the API route (`app/api/parcel/roads`); this
 * module runs offline and is unit-tested with a fixture.
 *
 * Data © OpenStreetMap contributors (ODbL). Roadway widths are estimates by
 * highway class (or the OSM `width` / `lanes` tags when present) — not a
 * surveyed right-of-way; verify against a plat for filing.
 */
import { FEET_PER_DEG_LAT, type LngLat, METRES_PER_FOOT, type PlanPoint } from './project'

const DEG2RAD = Math.PI / 180

/**
 * OSM highway classes we lay, each with a default roadway WIDTH (feet) and a
 * rank (lower = bigger road). Foot / cycle ways are narrow (sidewalks,
 * trails). Anything not listed is skipped.
 */
export const OSM_ROAD_CLASSES: Readonly<Record<string, { widthFt: number; rank: number }>> = {
  motorway: { widthFt: 48, rank: 0 },
  motorway_link: { widthFt: 24, rank: 0 },
  trunk: { widthFt: 44, rank: 1 },
  trunk_link: { widthFt: 22, rank: 1 },
  primary: { widthFt: 40, rank: 2 },
  primary_link: { widthFt: 20, rank: 2 },
  secondary: { widthFt: 34, rank: 3 },
  secondary_link: { widthFt: 18, rank: 3 },
  tertiary: { widthFt: 30, rank: 4 },
  tertiary_link: { widthFt: 18, rank: 4 },
  residential: { widthFt: 26, rank: 5 },
  living_street: { widthFt: 22, rank: 6 },
  unclassified: { widthFt: 24, rank: 6 },
  service: { widthFt: 16, rank: 7 },
  pedestrian: { widthFt: 12, rank: 8 },
  footway: { widthFt: 5, rank: 9 },
  path: { widthFt: 5, rank: 9 },
  cycleway: { widthFt: 6, rank: 9 },
}

/** Classes a house can FRONT: a street, not an alley, a driveway or a sidewalk. */
export const OSM_STREET_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'unclassified',
])

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
/** ~720 ft around the lot. */
export const OSM_DEFAULT_RADIUS_M = 220
/**
 * Public WORLD-WIDE Overpass mirrors (overpass.osm.ch is a Swiss extract and
 * answers a US query with nothing — it is deliberately not here). The route
 * asks them two at a time and takes the first good answer: on 2026-09-05
 * the main instance refused connections and two mirrors sat on a 504 for
 * half a minute while mail.ru answered in two seconds.
 */
export const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const

export interface OsmRoad {
  id: string
  name: string
  klass: string
  /** Roadway width, metres. */
  widthM: number
  oneway: boolean
  /** Way centerline in the site plan frame, metres, x east / z south. */
  centerline: PlanPoint[]
}

type Tags = Record<string, string | undefined>

/** The OSM highway class of a way's tags, or null when we do not lay it. */
export function classOf(tags: Tags | null | undefined): string | null {
  const h = tags?.highway
  return h && OSM_ROAD_CLASSES[h] ? h : null
}

/**
 * Roadway width in FEET: an explicit `width` tag (metres) wins, else a lane
 * count (~11 ft per lane + 4 ft), else the per-class default. Never under 3 ft.
 */
export function widthFtForWay(tags: Tags | null | undefined): number {
  const k = classOf(tags)
  let ft = (k && OSM_ROAD_CLASSES[k]?.widthFt) || 24
  const width = tags?.width
  const lanes = tags?.lanes
  if (width != null) {
    const m = Number.parseFloat(width)
    if (Number.isFinite(m) && m > 0) ft = m / METRES_PER_FOOT
  } else if (lanes != null) {
    const n = Number.parseInt(lanes, 10)
    if (Number.isFinite(n) && n > 0) ft = Math.max(ft, n * 11 + 4)
  }
  return Math.max(3, ft)
}

/**
 * Overpass QL: every highway way within `radiusM` of (lat, lng). `out geom`
 * returns each way's node coordinates inline — one round trip, no node pass.
 */
export function overpassQuery(lat: number, lng: number, radiusM: number): string {
  const r = Math.max(40, Math.min(1500, Math.round(radiusM || OSM_DEFAULT_RADIUS_M)))
  return `[out:json][timeout:25];(way["highway"](around:${r},${lat.toFixed(7)},${lng.toFixed(7)}););out body geom;`
}

/** One `[lng, lat]` into the plan frame, METRES, with `origin` at (0, 0). */
export function projectLngLat(p: LngLat, origin: LngLat): PlanPoint {
  const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(origin[1] * DEG2RAD)
  return [
    (p[0] - origin[0]) * ftPerDegLng * METRES_PER_FOOT,
    -(p[1] - origin[1]) * FEET_PER_DEG_LAT * METRES_PER_FOOT,
  ]
}

interface OverpassWayLike {
  type?: unknown
  id?: unknown
  tags?: Tags
  geometry?: { lat?: unknown; lon?: unknown }[]
}

/**
 * Overpass JSON (from `out geom`) → roads in the lot's plan frame, biggest
 * roads first. `clipRadiusM` drops ways with no vertex within that distance
 * of the origin (the geocoded point sits on the lot).
 */
export function parseOverpass(
  json: unknown,
  origin: LngLat,
  opts: { clipRadiusM?: number } = {},
): OsmRoad[] {
  const elements = (json as { elements?: unknown } | null | undefined)?.elements
  if (!Array.isArray(elements)) return []
  const clip = opts.clipRadiusM ?? 0
  const out: OsmRoad[] = []
  for (const el of elements) {
    const way = el as OverpassWayLike | null
    if (!way || way.type !== 'way') continue
    const tags = way.tags ?? {}
    const klass = classOf(tags)
    if (!klass) continue
    const geom = way.geometry
    if (!Array.isArray(geom) || geom.length < 2) continue
    const centerline: PlanPoint[] = []
    for (const g of geom) {
      const lon = Number(g?.lon)
      const lat = Number(g?.lat)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      centerline.push(projectLngLat([lon, lat], origin))
    }
    if (centerline.length < 2) continue
    if (clip > 0 && !centerline.some((p) => Math.hypot(p[0], p[1]) <= clip)) continue
    out.push({
      id: `osm${String(way.id ?? '')}`,
      name: tags.name ?? tags.ref ?? '',
      klass,
      widthM: widthFtForWay(tags) * METRES_PER_FOOT,
      oneway: tags.oneway === 'yes',
      centerline,
    })
  }
  out.sort(
    (a, b) => (OSM_ROAD_CLASSES[a.klass]?.rank ?? 99) - (OSM_ROAD_CLASSES[b.klass]?.rank ?? 99),
  )
  return out
}
