import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, type SiteNode, useScene } from '@pascal-app/core'
import { dropInLot } from './drop-in'
import type { ParcelResolveData } from './lot-patch'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const LAKELAND = '2715 Lake Hunter Dr, Lakeland, FL 33803'
const GAINESVILLE = '4121 NW 34th St, Gainesville, FL 32605'

const rect = (w: number, d: number): [number, number][] => [
  [-w / 2, -d / 2],
  [w / 2, -d / 2],
  [w / 2, d / 2],
  [-w / 2, d / 2],
]

// `/api/parcel/resolve` as the route answers it: `address` is null (the
// parcel service returns no situs line), apn / county / state / zip set.
const RESOLVED: Record<string, ParcelResolveData> = {
  [LAKELAND]: {
    ok: true,
    apn: '232824118500026120',
    county: 'Polk',
    state: 'FL',
    zip: '33803',
    zoning: '',
    lotAreaSqFt: 30796,
    originLngLat: [-81.965561971401, 28.029990868161],
    geocodedBy: 'arcgis-fl',
    notes: ['DRAFT — not a survey.'],
    polygonM: rect(80, 36),
    address: null,
  },
  [GAINESVILLE]: {
    ok: true,
    apn: '06075-030-062',
    county: 'Alachua',
    state: 'FL',
    zip: '32605',
    zoning: '',
    lotAreaSqFt: 10881,
    originLngLat: [-82.37262799515, 29.691261383561],
    geocodedBy: 'arcgis-fl',
    notes: ['DRAFT — not a survey.'],
    polygonM: rect(25, 32),
    address: null,
  },
}

// A Pascal Map dossier for the Lakeland lot: situs line, parcel key, county, flood zone.
const lakelandDossier = () => {
  const [lng, lat] = [-81.9656, 28.03]
  const d = 0.0002
  return {
    object: 'location',
    as_of: '2026-09-22T00:00:00Z',
    point: { lat, lng, source: 'geocoder' },
    address: { formatted: LAKELAND, precision: 'rooftop' },
    layers: {
      parcel: {
        layer: 'parcel',
        status: 'available',
        data: {
          parcel_key: '232824-118500-026120',
          county: { name: 'Polk' },
          situs_address: { line1: '2715 LAKE HUNTER DR', city: 'LAKELAND', zip: '33803' },
          area_m2: 2861,
          geometry: {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [lng - d, lat - d],
                  [lng + d, lat - d],
                  [lng + d, lat + d],
                  [lng - d, lat + d],
                  [lng - d, lat - d],
                ],
              ],
            },
          },
        },
      },
      boundaries: {
        layer: 'boundaries',
        status: 'available',
        data: { state: 'FL', zip: '33803', county: { name: 'Polk' } },
      },
      flood: { layer: 'flood', status: 'available', data: { zone_at_point: { zone: 'AE' } } },
      elevation: {
        layer: 'elevation',
        status: 'available',
        data: {
          terrain: {
            datum: 'NAVD88',
            contour_interval_ft: 1,
            geometry: {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: { elevation_ft: 150 },
                  geometry: {
                    type: 'LineString',
                    coordinates: [
                      [lng - d, lat],
                      [lng + d, lat],
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  }
}

/**
 * The editor's parcel routes, faked: the dossier answers only for
 * `dossierFor`; the elevation route reads a 40 ft west-to-east fall, or
 * fails when `elevation` is 'down'.
 */
function fakeRoutes(
  dossierFor: string | null,
  elevation: 'sloped' | 'down' = 'down',
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      address?: string
      points?: { lat: number; lng: number }[]
    }
    const path = String(url)
    if (path === '/api/parcel/elevation') {
      if (elevation === 'down')
        return new Response(JSON.stringify({ ok: false, error: 'USGS down' }))
      const west = Math.min(...(body.points ?? []).map((p) => p.lng))
      const results = (body.points ?? []).map((p) => ({
        ...p,
        elevation: 150 + (p.lng - west) * 100_000,
      }))
      return new Response(JSON.stringify({ ok: true, results }))
    }
    if (path === '/api/parcel/dossier') {
      return new Response(
        JSON.stringify(
          body.address === dossierFor
            ? { ok: true, dossier: lakelandDossier() }
            : { ok: false, reason: 'no MAP_API_KEY on the server' },
        ),
      )
    }
    if (path === '/api/parcel/resolve') {
      const data = RESOLVED[body.address ?? '']
      return new Response(JSON.stringify(data ?? { ok: false, error: 'no parcel found' }))
    }
    return new Response(JSON.stringify({ ok: false, reason: 'not faked' }))
  }) as typeof fetch
}

const site = (id: string) => useScene.getState().nodes[id as AnyNodeId] as SiteNode
const offline = { roads: false, terrain: false, terrainDeadlineMs: 0 } as const

/**
 * The QA lot, 4121 NW 34th St: a through lot, NW 34th Terrace along its west
 * line and NW 34th Street along its east line — the Terrace the nearer. The
 * ring and the centerlines as the parcel and roads routes answered them
 * (site metres, x east, z south).
 */
const QA_RING: [number, number][] = [
  [16.9, 18.5],
  [-16.5, 18.3],
  [-16.2, -12.8],
  [17.1, -12.6],
]
const QA_ROADS = [
  {
    id: 'way/terrace',
    name: 'Northwest 34th Terrace',
    klass: 'residential',
    widthM: 7.3,
    centerline: [
      [-22, 178],
      [-29, -73],
    ],
  },
  {
    id: 'way/street',
    name: 'Northwest 34th Street',
    klass: 'residential',
    widthM: 7.3,
    centerline: [
      [31, 93],
      [32.5, -142],
    ],
  },
]

/** The parcel routes for the QA lot: the resolver with its ring, the roads route with its two streets. */
function qaRoutes(): typeof fetch {
  const rest = fakeRoutes(null)
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path === '/api/parcel/resolve')
      return new Response(JSON.stringify({ ...RESOLVED[GAINESVILLE], polygonM: QA_RING }))
    if (path === '/api/parcel/roads')
      return new Response(JSON.stringify({ ok: true, roads: QA_ROADS }))
    return rest(url, init)
  }) as typeof fetch
}

describe('dropInLot on a through lot', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
  })

  test('4121 NW 34th St fronts NW 34th Street (east), not the nearer NW 34th Terrace (west)', async () => {
    const r = await dropInLot(
      { address: GAINESVILLE },
      { dossier: false, terrain: false, terrainDeadlineMs: 0, fetchImpl: qaRoutes() },
    )
    expect(r.ok).toBe(true)
    const s = site(r.siteId!)
    const ring = s.polygon!.points
    const front = s.frontEdge!
    const a = ring[front]!
    const b = ring[(front + 1) % ring.length]!
    // the front edge is the east line
    expect((a[0] + b[0]) / 2).toBeGreaterThan(15)
    expect(r.summary?.frontStreet).toBe('Northwest 34th Street')
    expect(s.parcel?.notes).toContain(
      `Front edge ${front + 1}: fronts "Northwest 34th Street" (OpenStreetMap, the addressed street).`,
    )
    // both street edges keep their own street's name
    const west = ring.findIndex((p, i) => {
      const q = ring[(i + 1) % ring.length]!
      return (p[0] + q[0]) / 2 < -15
    })
    expect([...(s.streetEdges ?? [])].sort()).toEqual([front, west].sort())
    expect((s.metadata as { streetNames?: Record<string, string> }).streetNames).toEqual({
      [String(west)]: 'Northwest 34th Terrace',
      [String(front)]: 'Northwest 34th Street',
    })
  })
})

describe('dropInLot onto a site that already has a lot', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
  })

  test('the second lot replaces the first lot’s address, APN and county', async () => {
    const fetchImpl = fakeRoutes(null)
    const first = await dropInLot({ address: LAKELAND }, { ...offline, fetchImpl })
    expect(first.ok).toBe(true)
    expect(site(first.siteId!).parcel?.county).toBe('Polk')

    const second = await dropInLot({ address: GAINESVILLE }, { ...offline, fetchImpl })
    expect(second.ok).toBe(true)
    expect(second.siteId).toBe(first.siteId)
    const s = site(second.siteId!)
    expect(s.address).toEqual({
      street: '4121 NW 34th St',
      city: 'Gainesville',
      state: 'FL',
      zip: '32605',
    })
    expect(s.parcel?.apn).toBe('06075-030-062')
    expect(s.parcel?.county).toBe('Alachua')
    expect(s.parcel?.lotAreaSqFt).toBe(10881)
  })

  test('a second lot the dossier does not answer drops the first lot’s situs and dossier facts', async () => {
    const fetchImpl = fakeRoutes(LAKELAND)
    const first = await dropInLot({ address: LAKELAND }, { ...offline, fetchImpl })
    expect(first.ok).toBe(true)
    const before = site(first.siteId!)
    expect(before.address?.city).toBe('LAKELAND')
    expect(before.dossier?.flood).toBeDefined()

    const second = await dropInLot({ address: GAINESVILLE }, { ...offline, fetchImpl })
    expect(second.ok).toBe(true)
    const s = site(second.siteId!)
    expect(s.address).toEqual({
      street: '4121 NW 34th St',
      city: 'Gainesville',
      state: 'FL',
      zip: '32605',
    })
    expect(s.parcel?.apn).toBe('06075-030-062')
    expect(s.parcel?.county).toBe('Alachua')
    expect(s.dossier).toBeUndefined()
  })

  test('a second lot whose ground read fails keeps none of the first lot’s terrain', async () => {
    const first = await dropInLot(
      { address: LAKELAND },
      { roads: false, terrainDeadlineMs: 0, fetchImpl: fakeRoutes(LAKELAND, 'sloped') },
    )
    expect(first.ok).toBe(true)
    expect(first.terrain?.flat).toBe(false)
    const before = site(first.siteId!)
    expect(before.terrain).toBeDefined()
    expect((before.metadata as Record<string, unknown>).terrainSample).toBeDefined()
    expect(before.terrainContours?.lines.length).toBeGreaterThan(0)

    const second = await dropInLot(
      { address: GAINESVILLE },
      { roads: false, terrainDeadlineMs: 0, fetchImpl: fakeRoutes(null, 'down') },
    )
    expect(second.ok).toBe(true)
    expect(second.terrain).toBeNull()
    expect(second.terrainFailure).toBe('USGS down')
    expect(second.message).toContain(
      'terrain read failed (USGS down) — the ground is flat until it is read',
    )
    const s = site(second.siteId!)
    expect(s.terrain).toBeUndefined()
    expect((s.metadata as Record<string, unknown>).terrainSample).toBeUndefined()
    expect(s.terrainContours).toBeUndefined()
  })
})
