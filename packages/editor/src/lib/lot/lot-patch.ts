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
 * - With the parcel fabric's frontage (Pascal Map), the front is the fronting
 *   edge on the addressed street (`frontageFront`), else the longest fronting
 *   edge; the note says which rule decided.
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
import { edgeLength, METRES_PER_FOOT, type Pt } from '../floorplan/site-plan/geometry'
import { sameStreet } from '../floorplan/site-plan/street-name'
import { cleanLotRing, describeRingCleanup } from './clean-ring'
import { detectFrontEdgeFromFrontage, type FrontageMatch } from './dossier'

export const DEFAULT_SETBACKS_FT = { front: 20, side: 5, rear: 15 } as const
export const DEFAULT_SETBACKS_M: SiteSetbacks = {
  front: DEFAULT_SETBACKS_FT.front * METRES_PER_FOOT,
  side: DEFAULT_SETBACKS_FT.side * METRES_PER_FOOT,
  rear: DEFAULT_SETBACKS_FT.rear * METRES_PER_FOOT,
}
export const DEFAULT_SETBACKS_SOURCE =
  'Planning defaults (front 20 ft, side 5 ft, rear 15 ft; typical single-family yards) — confirm with the zoning district.'

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

/** A trailing "ST zip" (US) or "STATE postcode" (AU), optionally after the city in the same part. */
const STATE_ZIP_TAIL = /^(?:(.*?)\s+)?([A-Z]{2}|NSW|VIC|QLD|TAS|ACT)(?:\s+(\d{4,5}(?:-\d{4})?))?$/i
const COUNTRY_PART = /^(usa?|u\.s\.a?\.?|united states(?: of america)?|australia)$/i

/**
 * The typed "street, city, ST zip" split into its parts — what the address
 * says when the resolver answered no situs line (the parcel route never
 * does). Without a comma it is all street.
 */
export function splitTypedAddress(typed: string | undefined): {
  street?: string
  city?: string
  state?: string
  zip?: string
} {
  const parts = String(typed ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > 1 && COUNTRY_PART.test(parts[parts.length - 1] as string)) parts.pop()
  if (parts.length === 0) return {}
  if (parts.length === 1) return { street: parts[0] }
  const tail = STATE_ZIP_TAIL.exec(parts[parts.length - 1] as string)
  if (!tail) return { street: parts.slice(0, -1).join(', '), city: parts[parts.length - 1] }
  const [, cityInTail, state, zip] = tail
  const streetParts = cityInTail ? parts.slice(0, -1) : parts.slice(0, -2)
  const city = cityInTail ?? (parts.length > 2 ? parts[parts.length - 2] : undefined)
  return {
    street: (streetParts.length > 0 ? streetParts : parts.slice(0, 1)).join(', '),
    ...(city ? { city } : {}),
    state: (state as string).toUpperCase(),
    ...(zip ? { zip } : {}),
  }
}

const streetOf = (input: DropInInput, data: ParcelResolveData): string | undefined =>
  input.street ?? data.address?.street ?? splitTypedAddress(input.address).street

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
 * Under this share of the longest frontage the addressed street's fronting
 * edge is a sliver of the lot (a corner cut, a flag's pole), not its face.
 */
export const ADDRESSED_FRONTAGE_MIN_SHARE = 0.5

/**
 * The front among the parcel fabric's fronting edges: the one on the
 * addressed street (a corner or through lot is addressed on its front
 * street) — `streetNames` are the mapped street along each edge — unless it
 * is under half the longest frontage; else the longest. `rule` says which
 * decided, for the note.
 */
export function frontageFront(
  ring: readonly Pt[],
  frontage: FrontageMatch,
  streetNames: Readonly<Record<string, string>>,
  addressStreet: string | null | undefined,
): { index: number; name: string; named: boolean; rule: string } {
  const nameOf = (i: number) => streetNames[String(i)] ?? ''
  const addressed = frontage.edges
    .filter((i) => sameStreet(addressStreet, nameOf(i)))
    .sort((a, b) => edgeLength(ring, b) - edgeLength(ring, a))[0]
  if (
    addressed !== undefined &&
    edgeLength(ring, addressed) >= frontage.lengthM * ADDRESSED_FRONTAGE_MIN_SHARE
  )
    return {
      index: addressed,
      name: nameOf(addressed),
      named: true,
      rule: "the addressed street's frontage",
    }
  const rule =
    addressed !== undefined
      ? `the longest frontage — the addressed street's edge ${addressed + 1} is ${edgeLength(ring, addressed).toFixed(1)} m, under half the longest ${frontage.lengthM.toFixed(1)} m`
      : frontage.edges.length === 1
        ? 'the only frontage'
        : frontage.edges.some((i) => nameOf(i))
          ? 'the longest frontage — no fronting street is the addressed street'
          : 'the longest frontage — no mapped street names to match the address'
  return { index: frontage.index, name: nameOf(frontage.index), named: false, rule }
}

/**
 * The site patch for a resolved parcel. `null` when the answer has no usable
 * ring. `now` stamps `parcel.resolvedAt` (injectable for tests).
 */
export function sitePatchFromParcel(
  site: (Pick<SiteNode, 'setbacks' | 'zone'> & { metadata?: unknown }) | null | undefined,
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
  // neighbour are the street (or water) edges, and the one on the addressed
  // street (else the longest) is the front; the road match names the
  // streets and stands in without a frontage; north-facing is the last resort.
  const frontage = dossier?.frontageSegmentsM?.length
    ? detectFrontEdgeFromFrontage(polygon as readonly Pt[], dossier.frontageSegmentsM)
    : null
  const fabricFront = frontage
    ? frontageFront(
        polygon as readonly Pt[],
        frontage,
        roadMatch?.streetNames ?? {},
        streetOf(input, data),
      )
    : null
  const match = fabricFront
    ? { index: fabricFront.index, distance: 0, name: fabricFront.name, named: fabricFront.named }
    : roadMatch
  // (site-annotations reads the street back from this note up to its ')')
  const frontNote =
    frontage && fabricFront
      ? `Front edge: edge ${fabricFront.index + 1} of the parcel fabric's frontage (${frontage.frontingEdges} fronting edge${frontage.frontingEdges === 1 ? '' : 's'}${fabricFront.name ? `, ${fabricFront.name}` : ''}) — ${fabricFront.rule} (Pascal Map).`
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

  // the street edges: the parcel fabric's frontage when it answered, else
  // every edge a mapped road runs along
  const streetEdges: number[] = frontage && frontage.edges.length > 0 ? frontage.edges : (roadMatch?.streetEdges ?? [])
  // the street each of those edges runs along, from the mapped roads (the
  // site plan labels every street edge with its own street, not the address's)
  const streetNames: Record<string, string> = {}
  for (const i of streetEdges) {
    const name = roadMatch?.streetNames?.[String(i)]
    if (name) streetNames[String(i)] = name
  }
  const typed = splitTypedAddress(input.address)
  const state = data.state || input.state || data.address?.state || typed.state
  const patch: Partial<SiteNode> = {
    address: {
      street: streetOf(input, data),
      city: input.city ?? data.address?.city ?? typed.city,
      state,
      zip: data.zip || input.zip || data.address?.zip || typed.zip,
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
    // every street edge (a corner lot has two or more) and the corner
    // clear-vision triangle's leg (measured from the right of way) — the
    // common residential 25 ft, verify locally
    ...(streetEdges.length > 0 ? { streetEdges } : {}),
    ...(streetEdges.length >= 2 ? { sightTriangleFt: 25 } : {}),
    // The parcel frame is x east / z south: plan up is true north.
    northRotation: 0,
    ...((dossier?.zone ?? data.zoning) && !site?.zone ? { zone: dossier?.zone ?? data.zoning } : {}),
    ...(zoned
      ? { setbacks: { ...zoned }, setbacksSource: dossier?.setbacksSource ?? 'zoning code via Pascal Map' }
      : setbacksDefaulted
        ? { setbacks: { ...DEFAULT_SETBACKS_M }, setbacksSource: DEFAULT_SETBACKS_SOURCE }
        : {}),
    // always written: undefined clears the previous lot's dossier when this lookup read none
    dossier: dossier?.facts,
    // the street each street edge runs along (`metadata.streetNames`, by
    // edge index) — the site plan names every street edge with its own
    // street; the previous lot's names never carry over
    metadata: (() => {
      const { streetNames: _previous, ...rest } = (
        site?.metadata && typeof site.metadata === 'object' && !Array.isArray(site.metadata) ? site.metadata : {}
      ) as Record<string, unknown>
      return Object.keys(streetNames).length > 0 ? { ...rest, streetNames } : rest
    })(),
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
