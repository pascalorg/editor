/**
 * The Pascal Map location dossier, read for the lot drop-in.
 *
 * `fetchDossier` asks the editor's own `/api/parcel/dossier` route (the key
 * lives there); the rest is pure: the parcel polygon and the FRONTAGE
 * (the boundary shared with no neighbour — the street edges) projected
 * into the site plan frame, the front edge picked from the frontage, the
 * zoning setbacks read with their citation, and the facts the plan set
 * prints (`siteFactsFromDossier`) with every geometry stripped.
 *
 * Every section carries `status`; `not_covered` / `not_available` mean
 * "not answered" — never a negative finding. Unknown keys are ignored
 * (the platform's additive-change policy).
 */
import type { SiteDossier } from '@pascal-app/core'

export type SectionStatus = 'available' | 'empty' | 'not_covered' | 'not_available'

export type DossierSection<T = Record<string, unknown>> = {
  layer: string
  name?: string
  status: SectionStatus
  summary?: string
  data?: T | null
  source?: { name?: string; kind?: string; vintage?: string; attribution?: string; note?: string }
  reason?: string
  hint?: string
}

export type Dossier = {
  object: 'location'
  as_of: string
  point: { lat: number; lng: number; source: string }
  address?: { formatted: string; precision: string }
  layers: Record<string, DossierSection>
}

export type LngLat = readonly [number, number]
export type Pt = readonly [number, number]

export type ParcelData = {
  parcel_key?: string
  county?: { name?: string | null; fips?: string | null; local_code?: number | null }
  situs_address?: { line1?: string; city?: string | null; zip?: string | null } | null
  vintage?: string | null
  area_m2?: number | null
  frontage?: { total_ft?: number; total_m?: number; segment_count?: number; geometry?: unknown } | null
  geometry?: { type?: string; geometry?: { type?: string; coordinates?: unknown } } | null
}

export type ZoningData = {
  district?: string
  district_description?: string | null
  jurisdiction?: string
  setbacks?: { front_ft?: number | null; side_ft?: number | null; rear_ft?: number | null } | null
  max_height_ft?: number | null
  max_far?: number | null
  min_lot_sqft?: number | null
  dimensional_note?: string | null
  dimensional_source?: { url?: string; section?: string; retrieved_at?: string } | null
  land_development_code_url?: string | null
}

export type CodeBasisData = {
  climate_zone_iecc?: string | null
  frost_depth_ft?: number | null
  ground_snow_load_psf?: number | null
  seismic_design_category?: string | null
  wind_speed_mph?: number | null
  wind_borne_debris_region?: boolean | null
  rainfall_100yr_24hr_in?: number | null
  climate_zone_title24?: string | null
  seismic_sds?: number | null
  seismic_sd1?: number | null
}

export type FloodData = {
  is_in_flood_zone?: boolean | null
  mapped?: boolean
  firm_panel?: { panel?: string; effective_date?: string | null } | null
  zone_at_point?: { zone?: string; description?: string; is_in_flood_zone?: boolean; base_flood_elevation_ft?: number | null; bfe_datum?: string } | null
  highest_risk_zone_on_parcel?: string | null
}

export type DossierResult = { ok: true; dossier: Dossier } | { ok: false; reason: string; code?: string; retryAfterS?: number }

/** Ask the editor's dossier route. Never throws: a failure is a reason. */
export async function fetchDossier(
  fetchImpl: typeof fetch,
  input: { address?: string; latitude?: number; longitude?: number; layers?: string[] },
): Promise<DossierResult> {
  try {
    const response = await fetchImpl('/api/parcel/dossier', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const json = (await response.json()) as { ok: boolean; dossier?: Dossier; reason?: string; code?: string; retryAfterS?: number }
    if (json.ok && json.dossier && json.dossier.layers) return { ok: true, dossier: json.dossier }
    return { ok: false, reason: json.reason ?? `dossier route answered ${response.status}`, code: json.code, retryAfterS: json.retryAfterS }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'dossier lookup failed' }
  }
}

/** A section by layer name, or null when the dossier has none. */
export function section<T = Record<string, unknown>>(dossier: Dossier | null | undefined, layer: string): DossierSection<T> | null {
  const s = dossier?.layers?.[layer]
  return s && typeof s === 'object' ? (s as DossierSection<T>) : null
}

/** A section's data when it answered (`available`), else null. */
export function answered<T = Record<string, unknown>>(dossier: Dossier | null | undefined, layer: string): T | null {
  const s = section<T>(dossier, layer)
  return s && s.status === 'available' && s.data && typeof s.data === 'object' ? s.data : null
}

/* ----------------------------------------------------------- projection */

/** 1° of latitude ≈ 364,000 ft — the same flat projection apps/editor/lib/parcel/project.ts uses. */
const FEET_PER_DEG_LAT = 364000
const METRES_PER_FOOT = 0.3048
const DEG2RAD = Math.PI / 180

/** `[lng, lat]` → plan METRES with `origin` at (0, 0): x east, z south. */
export function planPointFromLngLat(origin: LngLat, p: LngLat): Pt {
  const [oLng, oLat] = origin
  const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos(oLat * DEG2RAD)
  return [(p[0] - oLng) * ftPerDegLng * METRES_PER_FOOT, -(p[1] - oLat) * FEET_PER_DEG_LAT * METRES_PER_FOOT]
}

const isLngLat = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))

function ringArea(ring: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Pt
    const q = ring[(i + 1) % ring.length] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a) / 2
}

/**
 * The parcel's outer ring in plan metres: the largest polygon of a
 * Polygon / MultiPolygon Feature, closing vertex dropped, consecutive
 * duplicates removed. Empty when the section carries no usable geometry.
 */
export function parcelRingMetres(parcel: ParcelData | null | undefined, origin: LngLat): Pt[] {
  const geom = parcel?.geometry?.geometry
  if (!geom || typeof geom !== 'object') return []
  const type = geom.type
  const coords = geom.coordinates as unknown
  const rings: LngLat[][] = []
  if (type === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
    rings.push((coords[0] as unknown[]).filter(isLngLat) as LngLat[])
  } else if (type === 'MultiPolygon' && Array.isArray(coords)) {
    for (const poly of coords as unknown[]) {
      if (Array.isArray(poly) && Array.isArray(poly[0])) rings.push((poly[0] as unknown[]).filter(isLngLat) as LngLat[])
    }
  }
  let best: Pt[] = []
  let bestArea = 0
  for (const ring of rings) {
    const pts: Pt[] = []
    for (const ll of ring) {
      const p = planPointFromLngLat(origin, ll)
      const last = pts[pts.length - 1]
      if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue
      pts.push(p)
    }
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (pts.length > 3 && first && last && Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) pts.pop()
    if (pts.length < 3) continue
    const area = ringArea(pts)
    if (area > bestArea) {
      bestArea = area
      best = pts
    }
  }
  return best
}

/** The frontage as plan-metre segments (every consecutive pair of a MultiLineString / LineString). */
export function frontageSegmentsMetres(parcel: ParcelData | null | undefined, origin: LngLat): [Pt, Pt][] {
  const geom = parcel?.frontage?.geometry as { type?: string; coordinates?: unknown } | undefined
  if (!geom || typeof geom !== 'object') return []
  const lines: LngLat[][] = []
  if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) lines.push((geom.coordinates as unknown[]).filter(isLngLat) as LngLat[])
  else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
    for (const line of geom.coordinates as unknown[]) if (Array.isArray(line)) lines.push((line as unknown[]).filter(isLngLat) as LngLat[])
  }
  const out: [Pt, Pt][] = []
  for (const line of lines) {
    const pts = line.map((ll) => planPointFromLngLat(origin, ll))
    for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i] as Pt, pts[i + 1] as Pt])
  }
  return out
}

function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const l2 = abx * abx + abz * abz
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / l2))
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t))
}

export type FrontageMatch = {
  /** The lot edge index (points[index] → points[index + 1]). */
  index: number
  lengthM: number
  /** How many lot edges front the street / water — a corner lot has two or more. */
  frontingEdges: number
}

/**
 * The front edge from the FRONTAGE: a lot edge fronts when most of its
 * length lies on a frontage segment (five samples along it, each within
 * `tolM` — the ring is cleaned after the fabric was cut, so the tolerance
 * is generous). Of the fronting edges the LONGEST is the front (a corner
 * lot's long street). Null when no edge fronts.
 */
export function detectFrontEdgeFromFrontage(ring: readonly Pt[], segments: readonly [Pt, Pt][], tolM = 1.5): FrontageMatch | null {
  if (ring.length < 3 || segments.length === 0) return null
  let best: FrontageMatch | null = null
  let fronting = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt
    const b = ring[(i + 1) % ring.length] as Pt
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.5) continue
    let hits = 0
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      if (segments.some(([s0, s1]) => pointSegmentDistance(p, s0, s1) <= tolM)) hits += 1
    }
    if (hits < 3) continue
    fronting += 1
    if (!best || len > best.lengthM) best = { index: i, lengthM: len, frontingEdges: 0 }
  }
  return best ? { ...best, frontingEdges: fronting } : null
}

/* ----------------------------------------------------------- terrain contours */

export type ElevationData = {
  terrain_status?: string
  terrain?: {
    min_ft?: number
    max_ft?: number
    contour_interval_ft?: number
    contour_count?: number
    datum?: string
    source_resolution_m?: number
    geometry?: unknown
  } | null
}

export type ContourLines = {
  datum: string
  intervalFt: number
  source?: string
  lines: { elevationFt: number; points: [number, number][] }[]
}

/**
 * The dossier's USGS 3DEP contour lines (elevation.data.terrain.geometry —
 * a FeatureCollection of LineStrings with `elevation_ft`), projected into
 * the site frame. Consecutive points closer than 0.3 m are dropped (the
 * 10 m grid draws smooth curves with more vertices than a plan needs).
 * Null when the section carries no lines.
 */
export function contourLinesFromDossier(dossier: Dossier, origin: LngLat): ContourLines | null {
  const el = answered<ElevationData>(dossier, 'elevation')
  const terrain = el?.terrain
  const fc = terrain?.geometry as { type?: string; features?: unknown[] } | undefined
  if (!terrain || !fc || !Array.isArray(fc.features) || fc.features.length === 0) return null
  const lines: ContourLines['lines'] = []
  for (const f of fc.features as { geometry?: { type?: string; coordinates?: unknown }; properties?: { elevation_ft?: unknown } }[]) {
    const ft = f?.properties?.elevation_ft
    if (typeof ft !== 'number' || !Number.isFinite(ft)) continue
    const geom = f.geometry
    const parts: unknown[][] = []
    if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) parts.push(geom.coordinates as unknown[])
    else if (geom?.type === 'MultiLineString' && Array.isArray(geom.coordinates)) for (const l of geom.coordinates as unknown[]) if (Array.isArray(l)) parts.push(l as unknown[])
    for (const part of parts) {
      const pts: [number, number][] = []
      for (const ll of part) {
        if (!isLngLat(ll)) continue
        const p = planPointFromLngLat(origin, ll)
        const last = pts[pts.length - 1]
        if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.3) continue
        pts.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])
      }
      if (pts.length >= 2) lines.push({ elevationFt: ft, points: pts })
    }
  }
  if (lines.length === 0) return null
  const section = dossier.layers?.elevation
  return {
    datum: terrain.datum ?? 'NAVD88',
    intervalFt: typeof terrain.contour_interval_ft === 'number' ? terrain.contour_interval_ft : 1,
    source: `USGS 3DEP (~${terrain.source_resolution_m ?? 10} m) via Pascal Map${section?.source?.vintage ? ` (${section.source.vintage})` : ''}`,
    lines,
  }
}

/* ----------------------------------------------------------- zoning */

const FT = 0.3048

/**
 * Setbacks from the zoning section, METRES — null when the code expresses
 * a conditional rule (a null side) or the section did not answer: the
 * default then stands and the `dimensional_note` prints beside it.
 */
export function setbacksFromZoning(z: ZoningData | null | undefined): { front: number; side: number; rear: number } | null {
  const s = z?.setbacks
  if (!s) return null
  const f = s.front_ft
  const sd = s.side_ft
  const r = s.rear_ft
  if (typeof f !== 'number' || typeof sd !== 'number' || typeof r !== 'number') return null
  return { front: f * FT, side: sd * FT, rear: r * FT }
}

/** The citation line for `setbacksSource`. */
export function setbacksCitation(z: ZoningData, source?: DossierSection['source']): string {
  const sec = z.dimensional_source?.section ? `${z.dimensional_source.section}` : 'land development code'
  const url = z.dimensional_source?.url ?? z.land_development_code_url ?? ''
  return `Zoning ${z.district ?? ''} (${z.jurisdiction ?? 'jurisdiction'}) — ${sec}${url ? ` ${url}` : ''} — via Pascal Map${source?.vintage ? ` (${source.vintage})` : ''}`
}

/* ----------------------------------------------------------- facts */

const FACT_LAYERS = ['parcel', 'flood', 'code_basis', 'zoning', 'utilities', 'soils', 'wetlands', 'structures', 'elevation', 'boundaries'] as const

/** A section's data with every geometry stripped (they go to the site polygon / overlays, not the record). */
function stripGeometry(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k === 'geometry') continue
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = stripGeometry(v)
      if (inner) out[k] = inner
    } else out[k] = v
  }
  return out
}

/**
 * What the site node keeps of the dossier: when it was assembled, the
 * point and address it was evaluated at, every section's status +
 * summary + source, and the data of the sections the plan set acts on
 * (geometry-free). `parcel.adjacent_parcels` is dropped too — thirty
 * neighbours' keys are the platform's, not the plan's.
 */
export function siteFactsFromDossier(dossier: Dossier): SiteDossier {
  const sections: SiteDossier['sections'] = {}
  for (const [layer, s] of Object.entries(dossier.layers ?? {})) {
    if (!s || typeof s !== 'object') continue
    sections[layer] = {
      status: s.status,
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.source ? { source: { name: s.source.name, kind: s.source.kind, vintage: s.source.vintage, attribution: s.source.attribution } } : {}),
      ...(s.reason ? { reason: s.reason } : {}),
    }
  }
  const facts: SiteDossier = {
    provider: 'Pascal Map',
    asOf: dossier.as_of,
    point: { lat: dossier.point?.lat, lng: dossier.point?.lng, source: dossier.point?.source },
    ...(dossier.address ? { address: { formatted: dossier.address.formatted, precision: dossier.address.precision } } : {}),
    sections,
  }
  const key: Record<(typeof FACT_LAYERS)[number], keyof SiteDossier> = {
    parcel: 'parcel',
    flood: 'flood',
    code_basis: 'codeBasis',
    zoning: 'zoning',
    utilities: 'utilities',
    soils: 'soils',
    wetlands: 'wetlands',
    structures: 'structures',
    elevation: 'elevation',
    boundaries: 'boundaries',
  }
  for (const layer of FACT_LAYERS) {
    const data = answered(dossier, layer)
    if (!data) continue
    const stripped = stripGeometry(data)
    if (!stripped) continue
    if (layer === 'parcel') delete stripped.adjacent_parcels
    ;(facts as Record<string, unknown>)[key[layer]] = stripped
  }
  return facts
}

/** One line for the status row: which sections answered. */
export function describeDossier(dossier: Dossier): string {
  const yes: string[] = []
  const no: string[] = []
  for (const [layer, s] of Object.entries(dossier.layers ?? {})) {
    if (s.status === 'available' || s.status === 'empty') yes.push(layer)
    else no.push(layer)
  }
  return `Pascal Map: ${yes.length} sections answered${no.length ? ` (${no.join(', ')} not here)` : ''}`
}
