import { describe, expect, test } from 'bun:test'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField } from '../../lib/terrain-field'
import { migrateSiteMetadata, SiteNode } from './site'

describe('SiteNode.terrain', () => {
  test('a scene saved before terrain existed still parses', () => {
    const parsed = SiteNode.parse({ id: 'site_1', type: 'site' })
    expect(parsed.terrain).toBeUndefined()
    // And the default polygon is untouched by the new field.
    expect(parsed.polygon.points).toHaveLength(4)
  })

  test('accepts what the encoder produces, unchanged', () => {
    const field = createTerrainField({ cols: 5, rows: 5 })
    const heights = new Int16Array(field.heights)
    heights[12] = 250
    const data = encodeTerrainField({ ...field, heights })

    const parsed = SiteNode.parse({ id: 'site_1', type: 'site', terrain: data })
    expect(parsed.terrain).toEqual(data)
  })

  test('survives a JSON round-trip, which is how it is actually persisted', () => {
    const data = encodeTerrainField(createTerrainField({ cols: 3, rows: 3 }))
    const node = SiteNode.parse({ id: 'site_1', type: 'site', terrain: data })
    const reparsed = SiteNode.parse(JSON.parse(JSON.stringify(node)))
    expect(reparsed.terrain).toEqual(data)
  })

  test('rejects terrain with a zero or negative spacing', () => {
    const data = encodeTerrainField(createTerrainField({ cols: 3, rows: 3 }))
    expect(
      SiteNode.safeParse({ id: 'site_1', type: 'site', terrain: { ...data, spacing: 0 } }).success,
    ).toBe(false)
    expect(
      SiteNode.safeParse({ id: 'site_1', type: 'site', terrain: { ...data, step: -1 } }).success,
    ).toBe(false)
  })

  test('rejects non-integer dimensions and the wrong discriminator', () => {
    const data = encodeTerrainField(createTerrainField({ cols: 3, rows: 3 }))
    expect(
      SiteNode.safeParse({ id: 'site_1', type: 'site', terrain: { ...data, cols: 3.5 } }).success,
    ).toBe(false)
    expect(
      SiteNode.safeParse({ id: 'site_1', type: 'site', terrain: { ...data, type: 'polygon' } })
        .success,
    ).toBe(false)
  })

  test('rejects non-finite metadata and dimensions above the supported ceiling', () => {
    const data = encodeTerrainField(createTerrainField({ cols: 3, rows: 3 }))
    expect(
      SiteNode.safeParse({ id: 'site_1', type: 'site', terrain: { ...data, cols: 258 } }).success,
    ).toBe(false)
    expect(
      SiteNode.safeParse({
        id: 'site_1',
        type: 'site',
        terrain: { ...data, origin: [Number.POSITIVE_INFINITY, 0] },
      }).success,
    ).toBe(false)
  })
})

describe('SiteNode parcel / setback fields', () => {
  test('a scene that predates them still parses — every new field is optional', () => {
    const parsed = SiteNode.parse({ id: 'site_legacy', type: 'site' })
    expect(parsed.address).toBeUndefined()
    expect(parsed.parcel).toBeUndefined()
    expect(parsed.setbacks).toBeUndefined()
    expect(parsed.frontEdge).toBeUndefined()
    expect(parsed.northRotation).toBeUndefined()
    expect(parsed.polygon.points).toHaveLength(4)
  })

  test('round-trips a resolved parcel', () => {
    const parsed = SiteNode.parse({
      address: { city: 'Tampa', state: 'FL', street: '3612 W Palmira Ave', zip: '33629' },
      frontEdge: 2,
      id: 'site_1',
      northRotation: 0.15,
      parcel: {
        apn: '1829333TP000012000010A',
        county: 'Hillsborough',
        layer: 'arcgis-fl',
        lotAreaSqFt: 10487,
        originLngLat: [-82.502133736593, 27.922462714131],
        source: 'gis-parcel',
        state: 'FL',
      },
      setbacks: { front: 7.62, rear: 4.57, side: 2.29 },
      setbacksSource: 'Tampa LDC',
      type: 'site',
      zone: 'RS-60',
    })
    expect(parsed.parcel?.apn).toBe('1829333TP000012000010A')
    expect(parsed.parcel?.originLngLat?.[0]).toBeCloseTo(-82.502133736593, 9)
    expect(parsed.setbacks?.front).toBeCloseTo(7.62, 6)
    expect(parsed.frontEdge).toBe(2)
  })

  test('rejects a negative or fractional front-edge index', () => {
    expect(SiteNode.safeParse({ frontEdge: -1, id: 'site_x', type: 'site' }).success).toBe(false)
    expect(SiteNode.safeParse({ frontEdge: 1.5, id: 'site_x', type: 'site' }).success).toBe(false)
  })
})

describe('migrateSiteMetadata', () => {
  test('lifts setbacks / source / zone / apn out of metadata', () => {
    const patch = migrateSiteMetadata({
      metadata: {
        apn: '123-456',
        setbacks: { front: 7.62, rear: 4.57, side: 2.29 },
        setbacksSource: 'ordinance',
        source: 'gis-parcel',
        zone: 'RS-60',
      },
    })
    expect(patch.setbacks).toEqual({ front: 7.62, rear: 4.57, side: 2.29 })
    expect(patch.setbacksSource).toBe('ordinance')
    expect(patch.zone).toBe('RS-60')
    expect(patch.parcel).toEqual({ apn: '123-456', source: 'gis-parcel' })
  })

  test('never overwrites a value that already lives on the node', () => {
    const patch = migrateSiteMetadata({
      metadata: { apn: '999', setbacks: { front: 1, rear: 1, side: 1 }, zone: 'OLD' },
      parcel: { apn: 'KEEP' },
      setbacks: { front: 9, rear: 9, side: 9 },
      zone: 'NEW',
    })
    expect(patch).toEqual({})
  })

  test('is a no-op for missing, null, or malformed metadata', () => {
    expect(migrateSiteMetadata({})).toEqual({})
    expect(migrateSiteMetadata({ metadata: null })).toEqual({})
    expect(migrateSiteMetadata({ metadata: [1, 2] })).toEqual({})
    expect(migrateSiteMetadata({ metadata: { setbacks: { front: 3 } } })).toEqual({})
  })
})
