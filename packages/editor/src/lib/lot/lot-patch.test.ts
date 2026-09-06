import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SETBACKS_M,
  DEFAULT_SETBACKS_SOURCE,
  describeLotSummary,
  type ParcelResolveData,
  sitePatchFromParcel,
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
