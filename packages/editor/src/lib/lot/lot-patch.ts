/**
 * Lot drop-in — the PURE half. Given the parcel service's answer and the
 * mapped roads, compute the site node patch and a summary of what was
 * decided (front edge, setbacks, notes). No store, no network, so every
 * rule here is unit-tested; `drop-in.ts` does the fetching and writing.
 *
 * Rules (PlanCrafters' site pipeline, ported):
 * - The lot ring, address, parcel provenance and zoning come straight from
 *   `/api/parcel/resolve`; a new ring invalidates any front edge picked on
 *   the old one.
 * - The FRONT edge is the lot edge the real street fronts
 *   (`detectFrontEdgeFromRoads`: parallel, outside, nearest, addressed
 *   street wins on a corner). No road data → left undefined, which the site
 *   plan resolves to the most north-facing edge, and the notes say so.
 * - Setbacks: when the site has none, PlanCrafters' planning defaults
 *   (`SITE.DEFAULT_SETBACKS` — front 20 ft, side 5 ft, rear 15 ft) are
 *   written with a `setbacksSource` that says they are defaults. Existing
 *   setbacks are never overwritten.
 * - `northRotation` is 0: the parcel frame is x east / z south, so plan up
 *   is true north.
 */
import type { SiteNode, SiteSetbacks } from '@pascal-app/core'
import {
  detectFrontEdgeFromRoads,
  type FrontEdgeMatch,
  type RoadCenterline,
} from '../floorplan/site-plan/front-edge'
import { METRES_PER_FOOT, type Pt } from '../floorplan/site-plan/geometry'
import { cleanLotRing, describeRingCleanup } from './clean-ring'
import { detectFrontEdgeFromFrontage } from './dossier'

export const DEFAULT_SETBACKS_FT = { front: 20, side: 5, rear: 15 } as const
export const DEFAULT_SETBACKS_M: SiteSetbacks = {
  front: DEFAULT_SETBACKS_FT.front * METRES_PER_FOOT,
  side: DEFAULT_SETBACKS_FT.side * METRES_PER_FOOT,
  rear: DEFAULT_SETBACKS_FT.rear * METRES_PER_FOOT,
}
export const DEFAULT_SETBACKS_SOURCE =
  'Planning default — front 20 ft, side 5 ft, rear 15 ft (typical R-1 yards; PlanCrafters SITE.DEFAULT_SETBACKS). DRAFT: confirm with the zoning district.'

/** OSM highway classes a house can front: streets, not alleys, driveways or sidewalks. */
export const STREET_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living_street',
  'unclassified',
])

/** `/api/parcel/resolve`'s answer (the fields the drop-in reads). */
export interface ParcelResolveData {
  ok: boolean
  error?: string
  apn?: string
  county?: string
  state?: string
  zip?: string
  zoning?: string
  lotAreaSqFt?: number
  originLngLat?: [number, number]
  geocodedBy?: string
  matchPrecision?: string
  notes?: string[]
  polygonM?: [number, number][]
  address?: { street?: string; city?: string; state?: string; zip?: string } | null
}

/** A road from `/api/parcel/roads` (centerline in the lot's frame, metres). */
export interface LotRoad extends RoadCenterline {
  id?: string
  klass?: string
  widthM?: number
}

/** What the user typed or picked. Coordinates skip geocoding when present. */
export interface DropInInput {
  address?: string
  latitude?: number
  longitude?: number
  state?: string
  street?: string
  city?: string
  zip?: string
}

/**
 * What the Pascal Map dossier adds to a lot patch (lot drop-in, dossier.ts):
 * the frontage segments the front edge is read from, the zoning setbacks
 * with their citation, and the facts the site keeps for the sheets.
 */
export interface DossierExtras {
  /** Frontage segments in plan metres — the lot edges that touch no neighbour. */
  frontageSegmentsM?: readonly [readonly [number, number], readonly [number, number]][]
  /** Zoning setbacks, metres — null when the code's rule is conditional. */
  setbacks?: { front: number; side: number; rear: number } | null
  setbacksSource?: string
  /** The code's verbatim condition when a number cannot say it. */
  dimensionalNote?: string | null
  zone?: string
  /** The geometry-free record the site node keeps. */
  facts: SiteNode['dossier']
  /** One status line, e.g. "Pascal Map: 9 sections answered (parcel not here)". */
  line: string
}

export interface LotSummary {
  apn: string
  county: string
  state: string
  lotAreaSqFt: number
  /** The street-facing edge index, or null when the north-facing fallback stands. */
  frontEdge: number | null
  frontStreet: string | null
  frontEdgeSource: string
  /** How many lot edges front a street / water per the parcel fabric (corner lots ≥ 2); absent without frontage. */
  frontingEdges?: number
  /** The dossier's own status line, when one was read. */
  dossierLine?: string
  setbacksDefaulted: boolean
  roadsFound: number
  notes: string[]
}

const streetOf = (input: DropInInput, data: ParcelResolveData): string | undefined =>
  input.street ?? data.address?.street ?? input.address

/** The front-edge decision, as text for the parcel notes and the panel. */
export function describeFrontEdge(match: FrontEdgeMatch | null, roadsFound: number): string {
  if (match) {
    const name = match.name ? `"${match.name}"` : 'an unnamed street'
    return `Front edge ${match.index + 1}: fronts ${name} (OpenStreetMap${match.named ? ', the addressed street' : ', nearest street'}).`
  }
  return roadsFound > 0
    ? 'Front edge: no mapped street fronts a lot edge — the most north-facing edge stands; pick the street side in the Site panel.'
    : 'Front edge: no road data — the most north-facing edge stands; pick the street side in the Site panel.'
}

/**
 * The site patch for a resolved parcel. `null` when the answer has no usable
 * ring. `now` stamps `parcel.resolvedAt` (injectable for tests).
 */
export function sitePatchFromParcel(
  site: Pick<SiteNode, 'setbacks' | 'zone'> | null | undefined,
  input: DropInInput,
  data: ParcelResolveData,
  roads: readonly LotRoad[] | null,
  now: string = new Date().toISOString(),
  dossier?: DossierExtras | null,
): { patch: Partial<SiteNode>; summary: LotSummary } | null {
  const raw = data.polygonM
  if (!data.ok || !raw || raw.length < 3) return null
  // The registry ring, made fit for planning (curb returns squared, surplus
  // vertices gone) — see clean-ring.ts for why the raw ring cannot be used.
  const cleaned = cleanLotRing(raw as readonly Pt[])
  if (cleaned.points.length < 3) return null
  const polygon = cleaned.points.map((p) => [p[0], p[1]] as [number, number])
  const cleanupNote = describeRingCleanup(raw.length, cleaned)

  const streets = (roads ?? []).filter((r) => !r.klass || STREET_CLASSES.has(r.klass))
  const roadMatch = detectFrontEdgeFromRoads(polygon as readonly Pt[], streets, streetOf(input, data))
  // The parcel FABRIC beats the road match: the edges shared with no
  // neighbour are the street (or water) edges, and the longest of them is
  // the front; the road match names the street and stands in without a
  // frontage; north-facing is the last resort.
  const frontage = dossier?.frontageSegmentsM?.length
    ? detectFrontEdgeFromFrontage(polygon as readonly Pt[], dossier.frontageSegmentsM)
    : null
  const match = frontage
    ? { index: frontage.index, distance: 0, name: roadMatch?.index === frontage.index ? roadMatch.name : '', named: false }
    : roadMatch
  const frontNote = frontage
    ? `Front edge: edge ${frontage.index + 1} of the parcel fabric's frontage (${frontage.frontingEdges} fronting edge${frontage.frontingEdges === 1 ? '' : 's'}${roadMatch?.index === frontage.index && roadMatch.name ? `, ${roadMatch.name}` : ''}) — Pascal Map.`
    : describeFrontEdge(roadMatch, roads?.length ?? 0)

  // Setbacks: the site's own stay; else the zoning code's numbers with
  // their citation; else the default, with the code's condition printed
  // beside it when the dossier carried one.
  const zoned = !site?.setbacks && dossier?.setbacks ? dossier.setbacks : null
  const setbacksDefaulted = !site?.setbacks && !zoned
  const notes = [...(data.notes ?? []), ...(cleanupNote ? [cleanupNote] : []), frontNote]
  if (zoned) notes.push(`Setbacks: ${dossier?.setbacksSource ?? 'zoning code via Pascal Map'}`)
  if (setbacksDefaulted) notes.push(`Setbacks: ${DEFAULT_SETBACKS_SOURCE}`)
  if (dossier?.dimensionalNote) notes.push(`Zoning condition (verbatim, verify): ${dossier.dimensionalNote}`)
  if (dossier?.line) notes.push(dossier.line)

  const state = data.state || input.state || data.address?.state
  const patch: Partial<SiteNode> = {
    address: {
      street: streetOf(input, data),
      city: input.city ?? data.address?.city,
      state,
      zip: data.zip || input.zip || data.address?.zip,
    },
    parcel: {
      apn: data.apn,
      county: data.county,
      layer: data.geocodedBy,
      lotAreaSqFt: data.lotAreaSqFt,
      notes,
      originLngLat: data.originLngLat,
      resolvedAt: now,
      source: 'gis-parcel',
      state,
    },
    polygon: { points: polygon, type: 'polygon' },
    // A new lot invalidates a front-edge index picked on the old ring; the
    // street decides the new one.
    frontEdge: match ? match.index : undefined,
    // The parcel frame is x east / z south: plan up is true north.
    northRotation: 0,
    ...((dossier?.zone ?? data.zoning) && !site?.zone ? { zone: dossier?.zone ?? data.zoning } : {}),
    ...(zoned
      ? { setbacks: { ...zoned }, setbacksSource: dossier?.setbacksSource ?? 'zoning code via Pascal Map' }
      : setbacksDefaulted
        ? { setbacks: { ...DEFAULT_SETBACKS_M }, setbacksSource: DEFAULT_SETBACKS_SOURCE }
        : {}),
    ...(dossier?.facts ? { dossier: dossier.facts } : {}),
  }

  return {
    patch,
    summary: {
      apn: data.apn ?? '',
      county: data.county ?? '',
      state: state ?? '',
      lotAreaSqFt: data.lotAreaSqFt ?? 0,
      frontEdge: match ? match.index : null,
      frontStreet: match ? match.name || null : null,
      frontEdgeSource: frontage ? 'frontage' : match ? `osm:${match.name || 'unnamed'}` : 'north-facing',
      ...(frontage ? { frontingEdges: frontage.frontingEdges } : {}),
      ...(dossier?.line ? { dossierLine: dossier.line } : {}),
      setbacksDefaulted,
      roadsFound: roads?.length ?? 0,
      notes,
    },
  }
}

/** One line for a status row: "Lot set — APN 123 · 5,300 sq ft · Sacramento · fronts Castro Way · default setbacks". */
export function describeLotSummary(summary: LotSummary, extra: string[] = []): string {
  const parts = [
    summary.apn ? `APN ${summary.apn}` : '',
    summary.lotAreaSqFt ? `${Math.round(summary.lotAreaSqFt).toLocaleString('en-US')} sq ft` : '',
    summary.county,
    summary.frontEdge !== null
      ? summary.frontEdgeSource === 'frontage'
        ? `fronts ${summary.frontStreet || 'the street'} (edge ${summary.frontEdge + 1}, parcel frontage)`
        : `fronts ${summary.frontStreet ?? 'an unnamed street'} (edge ${summary.frontEdge + 1})`
      : 'front edge: most north-facing (no road match)',
    summary.dossierLine ?? '',
    summary.setbacksDefaulted ? 'setbacks defaulted 20 / 5 / 15 ft' : '',
    ...extra,
  ].filter(Boolean)
  return `Lot set — ${parts.join(' · ')}`
}
