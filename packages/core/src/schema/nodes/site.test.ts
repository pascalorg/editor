import { describe, expect, test } from 'bun:test'
import { resolveSetbackDistances } from '../../lib/setback-offset'
import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField } from '../../lib/terrain-field'
import { cloneSceneGraph } from '../../utils/clone-scene-graph'
import type { AnyNode, AnyNodeId } from '../types'
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

describe('SiteNode parcel, setbacks and zoning', () => {
  const parcel = {
    source: 'tkgm' as const,
    il: 'Ankara',
    ilce: 'Çankaya',
    mahalle: 'Remzi Oğuz Arık',
    mahalleId: 1162,
    ada: '2705',
    parsel: '15',
    registeredArea: 1295,
    nitelik: 'Apartman-Beton',
    pafta: 'I29b08d4c',
    fetchedAt: '2026-08-16T09:00:00.000Z',
  }

  test('a scene saved before any of this existed needs no migration', () => {
    const parsed = SiteNode.parse({ id: 'site_1', type: 'site' })
    expect(parsed.parcel).toBeUndefined()
    expect(parsed.setbacks).toEqual({})
    expect(parsed.defaultSetback).toBe(0)
    expect(parsed.zoning).toBeUndefined()
  })

  test('an imported parcel round-trips through JSON, which is how it persists', () => {
    const node = SiteNode.parse({
      id: 'site_1',
      type: 'site',
      parcel,
      setbacks: { '0': { role: 'road', distance: 5 }, '2': { role: 'rear', distance: 3 } },
      defaultSetback: 3,
      zoning: { taks: 0.4, kaks: 2, maxHeight: 15.5, maxFloors: 5, order: 'detached' },
    })

    expect(node.parcel?.edited).toBe(false)
    expect(SiteNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
  })

  test('rejects values a zoning reading could not survive', () => {
    const base = { id: 'site_1', type: 'site' }
    expect(SiteNode.safeParse({ ...base, zoning: { taks: 1.4 } }).success).toBe(false)
    expect(SiteNode.safeParse({ ...base, zoning: { maxFloors: 2.5 } }).success).toBe(false)
    expect(SiteNode.safeParse({ ...base, defaultSetback: -1 }).success).toBe(false)
    expect(
      SiteNode.safeParse({ ...base, setbacks: { '0': { role: 'front', distance: 5 } } }).success,
    ).toBe(false)
    expect(SiteNode.safeParse({ ...base, parcel: { ...parcel, mahalleId: 1.5 } }).success).toBe(
      false,
    )
  })

  test('an unlisted edge falls back to the site default', () => {
    const node = SiteNode.parse({
      id: 'site_1',
      type: 'site',
      setbacks: { '0': { role: 'road', distance: 5 } },
      defaultSetback: 3,
    })
    expect(resolveSetbackDistances(4, node.setbacks, node.defaultSetback)).toEqual([5, 3, 3, 3])
  })

  test('cloning a scene does not leave the setbacks record shared', () => {
    const site = SiteNode.parse({
      id: 'site_1',
      type: 'site',
      parcel,
      setbacks: { '0': { role: 'road', distance: 5 } },
    }) as unknown as AnyNode
    const cloned = cloneSceneGraph({
      nodes: { site_1: site } as Record<AnyNodeId, AnyNode>,
      rootNodeIds: ['site_1' as AnyNodeId],
    })

    const clonedSite = Object.values(cloned.nodes)[0] as unknown as SiteNode
    expect(clonedSite.setbacks).toEqual({ '0': { role: 'road', distance: 5 } })
    expect(clonedSite.parcel).toEqual(site.parcel)

    clonedSite.setbacks['0']!.distance = 99
    expect((site as unknown as SiteNode).setbacks['0']!.distance).toBe(5)
  })
})
