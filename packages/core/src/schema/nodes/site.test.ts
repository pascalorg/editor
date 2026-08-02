import { describe, expect, test } from 'bun:test'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField } from '../../lib/terrain-field'
import { SiteNode } from './site'

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
