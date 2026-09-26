/**
 * Lot drop-in — the store-aware half. One call does what "click a button,
 * the lot drops in" needs:
 *
 *   1. `resolve` — address (or a picked suggestion's
 *      coordinates) → the real parcel ring, APN, county, zoning.
 *   2. `roads` — the streets around the lot from OpenStreetMap,
 *      in the lot's own frame (fail-soft: no roads is not an error).
 *   3. `sitePatchFromParcel` — the site node patch: ring, address,
 *      provenance, the street-facing front edge, planning-default setbacks
 *      when the site has none, north up.
 *   4. The scene's site node is updated (created at the root when the scene
 *      has none) and a building that fell outside the new ring is
 *      re-centred on it — `building.position` only, never the walls.
 *   5. `elevation` — USGS ground over the lot into the site's
 *      heightfield (`site.terrain`, terrain.ts; fail-soft, flat lots write
 *      nothing), so a foundation can read the hill.
 *
 * Used by the Lot rail panel, the Generate panel (drop in, then generate)
 * and the Site inspector's "Find parcel", so every path behaves the same.
 * Nothing here is invented: a lookup that fails says why and writes nothing.
 * The calls go to the host's parcel provider (`setParcelProvider`).
 */
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  generateId,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  buildingRecentreOffset,
  buildSitePlanDrawing,
} from '../floorplan/site-plan/build-site-plan-drawing'
import {
  answered,
  type CodeBasisData,
  contourLinesFromDossier,
  type Dossier,
  describeDossier,
  type ElevationData,
  type FloodData,
  fetchDossier,
  frontageSegmentsMetres,
  type ParcelData,
  parcelRingMetres,
  setbacksCitation,
  setbacksFromZoning,
  siteFactsFromDossier,
  type ZoningData,
} from './dossier'
import {
  type DropInInput,
  describeLotSummary,
  type LotRoad,
  type LotSummary,
  type ParcelResolveData,
  sitePatchFromParcel,
} from './lot-patch'
import { getParcelProvider, NO_PARCEL_SERVICE, type ParcelProvider } from './parcel-provider'
import {
  describeTerrainSample,
  sampleLotTerrain,
  type TerrainSampleResult,
  type TerrainSampleSummary,
} from './terrain'

export interface LotDropInResult {
  ok: boolean
  error?: string
  siteId?: string
  summary?: LotSummary
  /** True when a building was moved back onto the new lot. */
  recentred?: boolean
  /** Why no roads were used, when the road lookup failed ('' when it worked). */
  roadsFailure?: string
  /** The USGS terrain read, when it worked (flat lots write no heightfield). */
  terrain?: TerrainSampleSummary | null
  /** Why no terrain was read ('' when it worked). */
  terrainFailure?: string
  /** The Pascal Map dossier's status line, or why none was read ('' when it worked). */
  dossierLine?: string
  dossierFailure?: string
  /** One status line. */
  message: string
}

export interface DropInOptions {
  /** The site to write; default = the scene's first root site (created when there is none). */
  siteId?: string
  /** Skip the road lookup (the front edge stays north-facing). */
  roads?: boolean
  roadsRadiusM?: number
  /** Skip the USGS terrain read (the ground stays flat). */
  terrain?: boolean
  terrainDeadlineMs?: number
  /** Skip the Pascal Map dossier (the parcel / roads / elevation routes alone). */
  dossier?: boolean
  /** Default = the provider the host set. */
  provider?: ParcelProvider
}

type RoadsResponse = { ok: boolean; reason?: string; roads?: LotRoad[] }

/** The scene's site node — the requested one, else the first root site. */
export function findSiteNode(siteId?: string): SiteNode | null {
  const s = useScene.getState()
  if (siteId) {
    const n = s.nodes[siteId as AnyNodeId] as AnyNode | undefined
    if (n?.type === 'site') return n as SiteNode
  }
  for (const id of s.rootNodeIds) {
    const n = s.nodes[id as AnyNodeId] as AnyNode | undefined
    if (n?.type === 'site') return n as SiteNode
  }
  return null
}

/** Resolve the parcel, map the streets, write the site. */
export async function dropInLot(
  input: DropInInput,
  options: DropInOptions = {},
): Promise<LotDropInResult> {
  const provider = options.provider ?? getParcelProvider()
  if (!provider) return { ok: false, error: 'no parcel service', message: NO_PARCEL_SERVICE }
  const address = (input.address ?? '').trim()
  const hasCoords = Number.isFinite(input.latitude) && Number.isFinite(input.longitude)
  if (!address && !hasCoords)
    return { ok: false, error: 'address is required', message: 'Type an address first.' }

  // The Pascal Map dossier first — the parcel with its frontage, the
  // zoning, flood, code basis, utilities, soils, wetlands, structures and
  // boundaries in one read. Where its parcel plane covers the lot the ring
  // comes from it; where it does not, the parcel route below stands and
  // the sections that DID answer (flood, utilities, …) still ride the site.
  let dossier: Dossier | null = null
  let dossierFailure = ''
  if (options.dossier !== false) {
    const read = await fetchDossier(provider, {
      address,
      ...(hasCoords ? { latitude: input.latitude, longitude: input.longitude } : {}),
    })
    if (read.ok) dossier = read.dossier
    else dossierFailure = read.reason
    // The parcel-wide 3DEP terrain warms up on the first look at a parcel
    // (~30 s, terrain_status 'computing'): one more ask for the elevation
    // section alone, after a wait, so the contour lines land on the first
    // drop-in and not the second.
    const el = dossier ? answered<ElevationData>(dossier, 'elevation') : null
    if (dossier && el?.terrain_status === 'computing' && options.terrainDeadlineMs !== 0) {
      await new Promise((r) => setTimeout(r, Math.min(30_000, options.terrainDeadlineMs ?? 20_000)))
      const again = await fetchDossier(provider, {
        address,
        ...(hasCoords ? { latitude: input.latitude, longitude: input.longitude } : {}),
        layers: ['elevation'],
      })
      if (again.ok && again.dossier.layers?.elevation) {
        dossier = {
          ...dossier,
          layers: { ...dossier.layers, elevation: again.dossier.layers.elevation },
        }
      }
    }
  } else dossierFailure = 'skipped'
  const dossierParcel = dossier ? answered<ParcelData>(dossier, 'parcel') : null
  const dossierOrigin: [number, number] | null =
    dossier && Number.isFinite(dossier.point?.lng) && Number.isFinite(dossier.point?.lat)
      ? [dossier.point.lng, dossier.point.lat]
      : null
  const dossierRing =
    dossierParcel && dossierOrigin ? parcelRingMetres(dossierParcel, dossierOrigin) : []

  let data: ParcelResolveData
  if (dossier && dossierParcel && dossierOrigin && dossierRing.length >= 3) {
    const boundaries = answered<{
      state?: string | null
      zip?: string | null
      county?: { name?: string | null }
    }>(dossier, 'boundaries')
    const zoning = answered<ZoningData>(dossier, 'zoning')
    const state = boundaries?.state ?? input.state
    data = {
      ok: true,
      apn: dossierParcel.parcel_key,
      county: dossierParcel.county?.name ?? boundaries?.county?.name ?? undefined,
      state: state ?? undefined,
      zip: dossierParcel.situs_address?.zip ?? boundaries?.zip ?? undefined,
      zoning: zoning?.district,
      lotAreaSqFt:
        typeof dossierParcel.area_m2 === 'number' ? dossierParcel.area_m2 * 10.7639 : undefined,
      originLngLat: dossierOrigin,
      geocodedBy: 'pascal-map',
      matchPrecision: dossier.address?.precision,
      notes: [
        `Parcel from Pascal Map${dossierParcel.vintage ? ` (${dossierParcel.vintage} roll)` : ''} — the county fabric; DRAFT, not a survey. Confirm corners before staking.`,
      ],
      polygonM: dossierRing.map((p) => [p[0], p[1]] as [number, number]),
      address: {
        street: dossierParcel.situs_address?.line1 ?? input.street,
        city: dossierParcel.situs_address?.city ?? input.city,
        state: state ?? undefined,
        zip: dossierParcel.situs_address?.zip ?? boundaries?.zip ?? input.zip,
      },
    }
  } else {
    try {
      data = (await provider('resolve', {
        address,
        ...(hasCoords
          ? { latitude: input.latitude, longitude: input.longitude, state: input.state }
          : {}),
      })) as ParcelResolveData
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Parcel lookup failed.'
      return { ok: false, error: message, message }
    }
    if (!data.ok || !data.polygonM || data.polygonM.length < 3) {
      const message = data.error ? `No parcel: ${data.error}` : 'No parcel found for that address.'
      return { ok: false, error: data.error ?? 'no parcel', message }
    }
  }
  // what the dossier adds to the patch: the frontage, the zoning, the facts
  const extras = dossier
    ? (() => {
        const zoning = answered<ZoningData>(dossier, 'zoning')
        const zoningSection = dossier.layers?.zoning
        const setbacks = setbacksFromZoning(zoning)
        return {
          frontageSegmentsM:
            dossierParcel && dossierOrigin && data.geocodedBy === 'pascal-map'
              ? frontageSegmentsMetres(dossierParcel, dossierOrigin)
              : [],
          setbacks,
          setbacksSource:
            zoning && setbacks ? setbacksCitation(zoning, zoningSection?.source) : undefined,
          dimensionalNote: zoning?.dimensional_note ?? null,
          zone: zoning?.district,
          facts: siteFactsFromDossier(dossier),
          line: describeDossier(dossier),
        }
      })()
    : null

  // Streets around the lot — fail-soft, but asked twice: the Overpass
  // mirrors time out now and then, and without the street the front edge
  // falls back to "most north-facing", which on a lot fronting a street to
  // the south turns the whole house round between one run and the next.
  let roads: LotRoad[] | null = null
  let roadsFailure = ''
  if (options.roads !== false && data.originLngLat) {
    for (let attempt = 0; attempt < 2 && !roads; attempt++) {
      try {
        const [lng, lat] = data.originLngLat
        const r = (await provider('roads', {
          latitude: lat,
          longitude: lng,
          originLngLat: data.originLngLat,
          radiusM: options.roadsRadiusM,
        })) as RoadsResponse
        if (r.ok && Array.isArray(r.roads)) {
          roads = r.roads
          roadsFailure = ''
        } else roadsFailure = r.reason ?? 'no roads'
      } catch (error) {
        roadsFailure = error instanceof Error ? error.message : 'road lookup failed'
      }
    }
  } else if (options.roads === false) {
    roadsFailure = 'skipped'
  }

  const scene = useScene.getState()
  let site = findSiteNode(options.siteId)
  if (!site) {
    site = SiteNode.parse({ id: generateId('site'), type: 'site', name: 'Site' })
    scene.createNodes([{ node: site as AnyNode }])
  }
  const computed = sitePatchFromParcel(site, input, data, roads, undefined, extras)
  if (!computed)
    return {
      ok: false,
      error: 'parcel geometry was unusable',
      message: 'The parcel geometry was unusable.',
    }
  // the surveyed contour lines ride the site with the patch (the site plan
  // draws them over the heightfield's own); absent without 3DEP lines
  const contours = dossier && dossierOrigin ? contourLinesFromDossier(dossier, dossierOrigin) : null
  useScene
    .getState()
    .updateNode(
      site.id as AnyNodeId,
      { ...computed.patch, terrainContours: contours ?? undefined } as Partial<AnyNode>,
    )

  // The ground over the lot — fail-soft. A sloping lot writes the
  // heightfield; a flat one (or a failed read) clears any terrain the
  // previous lot left behind so the site never shows another parcel's hill.
  let terrain: TerrainSampleSummary | null = null
  let terrainFailure = ''
  if (options.terrain !== false) {
    const read: TerrainSampleResult = data.originLngLat
      ? await sampleLotTerrain(computed.patch.polygon?.points ?? [], data.originLngLat, {
          provider,
          ...(options.terrainDeadlineMs ? { deadlineMs: options.terrainDeadlineMs } : {}),
        })
      : { ok: false, reason: 'no parcel origin' }
    const current = useScene.getState().nodes[site.id as AnyNodeId]
    const { terrainSample: _previous, ...meta } =
      current &&
      typeof current.metadata === 'object' &&
      current.metadata !== null &&
      !Array.isArray(current.metadata)
        ? (current.metadata as Record<string, unknown>)
        : {}
    if (read.ok && read.summary) {
      terrain = read.summary
      useScene.getState().updateNode(
        site.id as AnyNodeId,
        {
          terrain: read.terrain,
          metadata: { ...meta, terrainSample: read.summary },
        } as unknown as Partial<AnyNode>,
      )
    } else {
      terrainFailure = read.reason ?? 'no terrain'
      useScene
        .getState()
        .updateNode(
          site.id as AnyNodeId,
          { terrain: undefined, metadata: meta } as unknown as Partial<AnyNode>,
        )
    }
  } else {
    terrainFailure = 'skipped'
  }

  // Centre the building on the lot when its footprint fell outside the new ring.
  let recentred = false
  const after = useScene.getState()
  const drawing = buildSitePlanDrawing({
    collections: after.collections,
    installedPlugins: after.installedPlugins,
    materials: after.materials,
    nodes: after.nodes,
    rootNodeIds: after.rootNodeIds,
  })
  const offset = buildingRecentreOffset(drawing.meta.lot, drawing.meta.footprintBounds)
  if (offset && drawing.meta.buildingId) {
    const building = after.nodes[drawing.meta.buildingId as AnyNodeId] as BuildingNode | undefined
    if (building) {
      after.updateNode(building.id, {
        position: [
          building.position[0] + offset[0],
          building.position[1],
          building.position[2] + offset[1],
        ],
      })
      recentred = true
    }
  }

  const extra = [
    recentred ? 'building re-centred' : '',
    roadsFailure && roadsFailure !== 'skipped' ? `roads unavailable (${roadsFailure})` : '',
    describeTerrainSample(terrain, terrainFailure),
    dossierFailure && dossierFailure !== 'skipped'
      ? `Pascal Map unavailable (${dossierFailure})`
      : '',
    ...(dossier ? dossierHeadline(dossier) : []),
  ]
  return {
    ok: true,
    siteId: site.id,
    summary: computed.summary,
    recentred,
    roadsFailure,
    terrain,
    terrainFailure,
    dossierLine: dossier ? describeDossier(dossier) : '',
    dossierFailure,
    message: describeLotSummary(computed.summary, extra.filter(Boolean)),
  }
}

/** The facts a reader wants on the status line: the flood zone and the wind speed, when the dossier answered them. */
function dossierHeadline(dossier: Dossier): string[] {
  const out: string[] = []
  const flood = answered<FloodData>(dossier, 'flood')
  if (flood?.zone_at_point?.zone) {
    const z = flood.zone_at_point
    out.push(
      `flood zone ${z.zone}${typeof z.base_flood_elevation_ft === 'number' ? ` (BFE ${z.base_flood_elevation_ft} ft ${z.bfe_datum ?? ''})`.replace(/ \)$/, ')') : ''}${flood.firm_panel?.panel ? `, FIRM ${flood.firm_panel.panel}` : ''}`,
    )
  }
  const code = answered<CodeBasisData>(dossier, 'code_basis')
  if (typeof code?.wind_speed_mph === 'number') {
    out.push(
      `wind ${code.wind_speed_mph} mph${code.wind_borne_debris_region ? ' (debris region)' : ''}${code.climate_zone_iecc ? `, zone ${code.climate_zone_iecc}` : ''}`,
    )
  }
  return out
}
