/**
 * Lot drop-in — the store-aware half. One call does what "click a button,
 * the lot drops in" needs (Steve, 2026-09-05):
 *
 *   1. `/api/parcel/resolve` — address (or a picked suggestion's
 *      coordinates) → the real parcel ring, APN, county, zoning.
 *   2. `/api/parcel/roads` — the streets around the lot from OpenStreetMap,
 *      in the lot's own frame (fail-soft: no roads is not an error).
 *   3. `sitePatchFromParcel` — the site node patch: ring, address,
 *      provenance, the street-facing front edge, planning-default setbacks
 *      when the site has none, north up.
 *   4. The scene's site node is updated (created at the root when the scene
 *      has none) and a building that fell outside the new ring is
 *      re-centred on it — `building.position` only, never the walls.
 *   5. `/api/parcel/elevation` — USGS ground over the lot into the site's
 *      heightfield (`site.terrain`, terrain.ts; fail-soft, flat lots write
 *      nothing), so the generator's foundation and Bones' footings can read
 *      the hill.
 *
 * Used by the Lot rail panel, the Generate panel (drop in, then generate)
 * and the Site inspector's "Find parcel", so every path behaves the same.
 * Nothing here is invented: a lookup that fails says why and writes nothing.
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
  type DropInInput,
  describeLotSummary,
  type LotRoad,
  type LotSummary,
  type ParcelResolveData,
  sitePatchFromParcel,
} from './lot-patch'
import { describeTerrainSample, sampleLotTerrain, type TerrainSampleSummary } from './terrain'

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
  fetchImpl?: typeof fetch
}

type RoadsResponse = { ok: boolean; reason?: string; roads?: LotRoad[] }

async function postJson<T>(fetchImpl: typeof fetch, url: string, body: unknown): Promise<T> {
  const response = await fetchImpl(url, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  return (await response.json()) as T
}

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
  const fetchImpl = options.fetchImpl ?? fetch
  const address = (input.address ?? '').trim()
  const hasCoords = Number.isFinite(input.latitude) && Number.isFinite(input.longitude)
  if (!address && !hasCoords)
    return { ok: false, error: 'address is required', message: 'Type an address first.' }

  let data: ParcelResolveData
  try {
    data = await postJson<ParcelResolveData>(fetchImpl, '/api/parcel/resolve', {
      address,
      ...(hasCoords
        ? { latitude: input.latitude, longitude: input.longitude, state: input.state }
        : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parcel lookup failed.'
    return { ok: false, error: message, message }
  }
  if (!data.ok || !data.polygonM || data.polygonM.length < 3) {
    const message = data.error ? `No parcel: ${data.error}` : 'No parcel found for that address.'
    return { ok: false, error: data.error ?? 'no parcel', message }
  }

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
        const r = await postJson<RoadsResponse>(fetchImpl, '/api/parcel/roads', {
          latitude: lat,
          longitude: lng,
          originLngLat: data.originLngLat,
          radiusM: options.roadsRadiusM,
        })
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
  const computed = sitePatchFromParcel(site, input, data, roads)
  if (!computed)
    return {
      ok: false,
      error: 'parcel geometry was unusable',
      message: 'The parcel geometry was unusable.',
    }
  useScene.getState().updateNode(site.id as AnyNodeId, computed.patch as Partial<AnyNode>)

  // The ground over the lot — fail-soft. A sloping lot writes the
  // heightfield; a flat one (or a failed read) clears any terrain the
  // previous lot left behind so the site never shows another parcel's hill.
  let terrain: TerrainSampleSummary | null = null
  let terrainFailure = ''
  if (options.terrain !== false && data.originLngLat) {
    const read = await sampleLotTerrain(computed.patch.polygon?.points ?? [], data.originLngLat, {
      fetchImpl,
      ...(options.terrainDeadlineMs ? { deadlineMs: options.terrainDeadlineMs } : {}),
    })
    if (read.ok && read.summary) {
      terrain = read.summary
      const current = useScene.getState().nodes[site.id as AnyNodeId]
      const meta =
        current &&
        typeof current.metadata === 'object' &&
        current.metadata !== null &&
        !Array.isArray(current.metadata)
          ? (current.metadata as Record<string, unknown>)
          : {}
      useScene.getState().updateNode(
        site.id as AnyNodeId,
        {
          terrain: read.terrain,
          metadata: { ...meta, terrainSample: read.summary },
        } as unknown as Partial<AnyNode>,
      )
    } else {
      terrainFailure = read.reason ?? 'no terrain'
    }
  } else if (options.terrain === false) {
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
  ]
  return {
    ok: true,
    siteId: site.id,
    summary: computed.summary,
    recentred,
    roadsFailure,
    terrain,
    terrainFailure,
    message: describeLotSummary(computed.summary, extra.filter(Boolean)),
  }
}
