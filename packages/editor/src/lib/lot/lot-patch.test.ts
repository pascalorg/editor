import { describe, expect, test } from 'bun:test'
import { edgeLength } from '../floorplan/site-plan/geometry'
import {
  DEFAULT_SETBACKS_M,
  DEFAULT_SETBACKS_SOURCE,
  type DossierExtras,
  describeLotSummary,
  type ParcelResolveData,
  sitePatchFromParcel,
  splitTypedAddress,
} from './lot-patch'

const NOW = '2026-09-06T00:00:00.000Z'
// 20 × 30 m lot; edge 0 north, 1 east, 2 south, 3 west
const POLY: [number, number][] = [
  [-10, -15],
  [10, -15],
  [10, 15],
  [-10, 15],
]
const resolved = (over: Partial<ParcelResolveData> = {}): ParcelResolveData => ({
  ok: true,
  apn: '009-0123-004',
  county: 'Sacramento',
  state: 'CA',
  zip: '95818',
  zoning: 'R-1',
  lotAreaSqFt: 6458,
  originLngLat: [-121.480667, 38.553517],
  geocodedBy: 'arcgis-ca',
  notes: ['DRAFT — not a survey.'],
  polygonM: POLY,
  address: { street: '2600 Castro Way', city: 'Sacramento', state: 'CA', zip: '95818' },
  ...over,
})
const roads = [
  {
    name: 'Castro Way',
    klass: 'residential',
    centerline: [
      [-60, -25],
      [60, -25],
    ] as [number, number][],
  },
  {
    name: 'Back Alley',
    klass: 'service',
    centerline: [
      [-60, 20],
      [60, 20],
    ] as [number, number][],
  },
]

describe('sitePatchFromParcel', () => {
  test('writes the lot, the address, the provenance and the street-facing front edge', () => {
    const out = sitePatchFromParcel(
      null,
      { address: '2600 Castro Way, Sacramento, CA' },
      resolved(),
      roads,
      NOW,
    )!
    expect(out).not.toBeNull()
    expect(out.patch.polygon).toEqual({ points: POLY, type: 'polygon' })
    expect(out.patch.address).toEqual({
      street: '2600 Castro Way',
      city: 'Sacramento',
      state: 'CA',
      zip: '95818',
    })
    expect(out.patch.parcel?.apn).toBe('009-0123-004')
    expect(out.patch.parcel?.resolvedAt).toBe(NOW)
    expect(out.patch.parcel?.source).toBe('gis-parcel')
    expect(out.patch.frontEdge).toBe(0)
    expect(out.patch.northRotation).toBe(0)
    expect(out.patch.zone).toBe('R-1')
    expect(out.summary.frontStreet).toBe('Castro Way')
    expect(out.summary.frontEdgeSource).toBe('osm:Castro Way')
    expect(out.summary.roadsFound).toBe(2)
    expect(out.patch.parcel?.notes?.[1]).toContain('fronts "Castro Way"')
    expect(out.patch.parcel?.notes?.[1]).toContain('the addressed street')
  })

  test('an alley behind the lot never claims the frontage — only street classes count', () => {
    // the alley is 5 m off the south edge, the street 10 m off the north edge
    const out = sitePatchFromParcel(null, {}, resolved({ address: null }), roads, NOW)!
    expect(out.patch.frontEdge).toBe(0)
  })

  test('setbacks default to 20 / 5 / 15 ft with a source that says so, and never overwrite existing ones', () => {
    const fresh = sitePatchFromParcel(null, {}, resolved(), roads, NOW)!
    expect(fresh.patch.setbacks).toEqual(DEFAULT_SETBACKS_M)
    expect(fresh.patch.setbacksSource).toBe(DEFAULT_SETBACKS_SOURCE)
    expect(fresh.summary.setbacksDefaulted).toBe(true)
    expect(fresh.patch.parcel?.notes?.some((n) => n.startsWith('Setbacks: Planning default'))).toBe(
      true,
    )

    const kept = sitePatchFromParcel(
      { setbacks: { front: 7.62, side: 3.048, rear: 6.096 }, zone: 'RS-60' },
      {},
      resolved(),
      roads,
      NOW,
    )!
    expect(kept.patch.setbacks).toBeUndefined()
    expect(kept.patch.setbacksSource).toBeUndefined()
    expect(kept.patch.zone).toBeUndefined() // the user's zone stands
    expect(kept.summary.setbacksDefaulted).toBe(false)
  })

  test('no road data: front edge left to the north-facing fallback, and the notes say so', () => {
    const out = sitePatchFromParcel(null, {}, resolved(), null, NOW)!
    expect(out.patch.frontEdge).toBeUndefined()
    expect('frontEdge' in out.patch).toBe(true) // the old index is cleared, not kept
    expect(out.summary.frontEdge).toBeNull()
    expect(out.summary.frontEdgeSource).toBe('north-facing')
    expect(out.summary.notes.some((n) => n.includes('no road data'))).toBe(true)
    const nothingFronts = sitePatchFromParcel(
      null,
      {},
      resolved(),
      [
        {
          name: 'X',
          klass: 'residential',
          centerline: [
            [0, -60],
            [0, -25],
          ],
        },
      ],
      NOW,
    )!
    expect(nothingFronts.summary.notes.some((n) => n.includes('no mapped street fronts'))).toBe(
      true,
    )
  })

  test('a picked suggestion supplies the street and city when the resolver has no address', () => {
    const out = sitePatchFromParcel(
      null,
      { address: 'x', street: '3415 N Troy St', city: 'Chicago', state: 'IL', zip: '60618' },
      resolved({ address: null, state: '', zip: '' }),
      null,
      NOW,
    )!
    expect(out.patch.address).toEqual({
      street: '3415 N Troy St',
      city: 'Chicago',
      state: 'IL',
      zip: '60618',
    })
    expect(out.summary.state).toBe('IL')
  })

  test('no situs line from the resolver: the typed address is split into street, city, state, zip', () => {
    const out = sitePatchFromParcel(
      null,
      { address: '2715 Lake Hunter Dr, Lakeland, FL 33803' },
      resolved({ address: null, state: '', zip: '' }),
      null,
      NOW,
    )!
    expect(out.patch.address).toEqual({
      street: '2715 Lake Hunter Dr',
      city: 'Lakeland',
      state: 'FL',
      zip: '33803',
    })
  })

  test('a failed or ringless answer gives nothing', () => {
    expect(sitePatchFromParcel(null, {}, { ok: false, error: 'nope' }, null, NOW)).toBeNull()
    expect(
      sitePatchFromParcel(
        null,
        {},
        resolved({
          polygonM: [
            [0, 0],
            [1, 1],
          ],
        }),
        null,
        NOW,
      ),
    ).toBeNull()
  })

  test('describeLotSummary reads as one status line', () => {
    const out = sitePatchFromParcel(null, {}, resolved(), roads, NOW)!
    expect(describeLotSummary(out.summary, ['building re-centred'])).toBe(
      'Lot set — APN 009-0123-004 · 6,458 sq ft · Sacramento · fronts Castro Way (edge 1) · setbacks defaulted 20 / 5 / 15 ft · building re-centred',
    )
  })
})

describe('the front among the parcel fabric’s frontage', () => {
  type Ring = [number, number][]
  /** The fabric's frontage: these edges of the ring touch no neighbour. */
  const fabric = (ring: Ring, edges: number[]): DossierExtras => ({
    frontageSegmentsM: edges.map((i) => [ring[i]!, ring[(i + 1) % ring.length]!] as const),
    facts: undefined,
    line: '',
  })
  const road = (name: string, a: [number, number], b: [number, number]) => ({
    name,
    klass: 'residential',
    centerline: [a, b],
  })
  const frontNote = (notes: string[]) => notes.find((n) => n.startsWith('Front edge'))

  // the QA lot, 4121 NW 34th St: a through lot, NW 34th Terrace along its
  // west line (edge 1), NW 34th Street along its east line (edge 3)
  const QA: Ring = [
    [16.9, 18.5],
    [-16.5, 18.3],
    [-16.2, -12.8],
    [17.1, -12.6],
  ]
  const QA_ROADS = [
    road('Northwest 34th Terrace', [-22, 178], [-29, -73]),
    road('Northwest 34th Street', [31, 93], [32.5, -142]),
  ]

  test('a through lot fronts the addressed street’s frontage, though the other is 1 mm longer', () => {
    // both frontages 31.10 m; the Terrace's (west) the longer by under a millimetre
    expect(edgeLength(QA, 1)).toBeCloseTo(31.1, 1)
    expect(edgeLength(QA, 3)).toBeCloseTo(31.1, 1)
    expect(edgeLength(QA, 1) - edgeLength(QA, 3)).toBeGreaterThan(0)
    expect(edgeLength(QA, 1) - edgeLength(QA, 3)).toBeLessThan(0.002)

    const out = sitePatchFromParcel(
      null,
      { address: '4121 NW 34th St, Gainesville, FL 32605' },
      resolved({ polygonM: QA, address: null }),
      QA_ROADS,
      NOW,
      fabric(QA, [1, 3]),
    )!
    expect(out.patch.frontEdge).toBe(3)
    expect(out.summary.frontEdgeSource).toBe('frontage')
    expect(out.summary.frontStreet).toBe('Northwest 34th Street')
    expect(frontNote(out.summary.notes)).toBe(
      "Front edge: edge 4 of the parcel fabric's frontage (2 fronting edges, Northwest 34th Street) — the addressed street's frontage (Pascal Map).",
    )
    expect(out.patch.streetEdges).toEqual([1, 3])
    expect((out.patch.metadata as { streetNames?: unknown }).streetNames).toEqual({
      '1': 'Northwest 34th Terrace',
      '3': 'Northwest 34th Street',
    })
  })

  test('with no street names to match, the longest frontage stands, and the note says why', () => {
    const out = sitePatchFromParcel(
      null,
      { address: '4121 NW 34th St, Gainesville, FL 32605' },
      resolved({ polygonM: QA, address: null }),
      null,
      NOW,
      fabric(QA, [1, 3]),
    )!
    expect(out.patch.frontEdge).toBe(1)
    expect(frontNote(out.summary.notes)).toBe(
      "Front edge: edge 2 of the parcel fabric's frontage (2 fronting edges) — the longest frontage — no mapped street names to match the address (Pascal Map).",
    )
  })

  // a corner lot, 30 m along Main Street (north, edge 0), 12 m along Oak Avenue (east, edge 1)
  const CORNER: Ring = [
    [-15, -6],
    [15, -6],
    [15, 6],
    [-15, 6],
  ]
  const CORNER_ROADS = [
    road('Main Street', [-60, -15], [60, -15]),
    road('Oak Avenue', [24, -60], [24, 60]),
  ]
  const corner = (address: string) =>
    sitePatchFromParcel(
      null,
      { address },
      resolved({ polygonM: CORNER, address: null }),
      CORNER_ROADS,
      NOW,
      fabric(CORNER, [0, 1]),
    )!

  test('the addressed street’s frontage wins on a corner lot when it is the lot’s face', () => {
    const out = corner('12 Main St, Springfield, IL 62701')
    expect(out.patch.frontEdge).toBe(0)
    expect(frontNote(out.summary.notes)).toContain(
      "— the addressed street's frontage (Pascal Map).",
    )
  })

  test('an addressed frontage under half the longest is a sliver: the longest stands', () => {
    const out = corner('12 Oak Ave, Springfield, IL 62701')
    expect(out.patch.frontEdge).toBe(0)
    expect(out.summary.frontStreet).toBe('Main Street')
    expect(frontNote(out.summary.notes)).toBe(
      "Front edge: edge 1 of the parcel fabric's frontage (2 fronting edges, Main Street) — the longest frontage — the addressed street's edge 2 is 12.0 m, under half the longest 30.0 m (Pascal Map).",
    )
  })

  test('no fronting street is the addressed street: the longest stands', () => {
    const out = corner('9 Nowhere Ln, Springfield, IL 62701')
    expect(out.patch.frontEdge).toBe(0)
    expect(frontNote(out.summary.notes)).toContain(
      '— the longest frontage — no fronting street is the addressed street (Pascal Map).',
    )
  })
})

describe('splitTypedAddress', () => {
  test.each([
    [
      '4121 NW 34th St, Gainesville, FL 32605',
      { street: '4121 NW 34th St', city: 'Gainesville', state: 'FL', zip: '32605' },
    ],
    ['1200 W Cass St, Tampa, FL', { street: '1200 W Cass St', city: 'Tampa', state: 'FL' }],
    [
      '2600 Castro Way, Sacramento CA 95818-1234, USA',
      { street: '2600 Castro Way', city: 'Sacramento', state: 'CA', zip: '95818-1234' },
    ],
    [
      '12 Smith St, Perth WA 6000',
      { street: '12 Smith St', city: 'Perth', state: 'WA', zip: '6000' },
    ],
    ['2715 Lake Hunter Dr, FL 33803', { street: '2715 Lake Hunter Dr', state: 'FL', zip: '33803' }],
    ['1200 W Cass St, Tampa', { street: '1200 W Cass St', city: 'Tampa' }],
    ['Kent Way & Deborah Lane', { street: 'Kent Way & Deborah Lane' }],
    ['', {}],
  ])('%p', (typed, parts) => {
    expect(splitTypedAddress(typed)).toEqual(parts)
  })
})
