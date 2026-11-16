import { describe, expect, test } from 'bun:test'
import type { AnyNode, SiteNode } from '../schema'
import { RING_A, RING_C, terrainLagScene } from './__fixtures__/terrain-lag-scenes'
import { heightAt } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

/*
 * Failure modes this file pins (the terrain lag, 15 Oct): the persisted authority was rebuilt, as a
 * new field object every consumer re-reads, whenever the site node object changed, which it does
 * each time a child (a ramp, a rock, a tile, a fence) is added under the site.
 * - a child appended to the site gives a new field, and every tile mesh is rebuilt for nothing;
 * - the cache then answers with a field of other tiles, breaks or lot after a real edit.
 */

const scene = () =>
  terrainLagScene('rings', {
    breaks: [
      { line: RING_A, left: -3.8, right: 'ground' },
      { line: RING_C, left: -3.6, right: 'ground' },
    ],
  })

const withSite = (nodes: Record<string, AnyNode>, site: SiteNode) => ({ ...nodes, [site.id]: site })

describe('the persisted authority is one field per set of inputs', () => {
  test('a child appended to the site, or its metadata, keeps the field', () => {
    const { site, nodes } = scene()
    const before = persistedTerrainFieldOf(site, nodes)
    const appended = { ...site, children: [...site.children, 'ramp_new'] } as SiteNode
    const named = { ...site, metadata: { note: 'x' } } as SiteNode
    expect(persistedTerrainFieldOf(appended, withSite(nodes, appended))).toBe(before)
    expect(persistedTerrainFieldOf(named, withSite(nodes, named))).toBe(before)
  })

  test('a moved lot corner, an edited tile and an edited break each give the field they should', () => {
    const { site, nodes } = scene()
    const before = persistedTerrainFieldOf(site, nodes)!
    const probe: [number, number][] = [
      [-30, -30],
      [-12, 14],
      [0, 0],
      [13, 7],
      [40, 40],
      [-60, 20],
    ]

    const polygon = {
      ...site.polygon,
      points: site.polygon.points.map(([x, z], i) => (i === 0 ? [x - 30, z - 30] : [x, z])),
    }
    const resized = { ...site, polygon } as SiteNode
    const bigger = persistedTerrainFieldOf(resized, withSite(nodes, resized))!
    expect(bigger).not.toBe(before)
    expect(bigger.origin[0]).toBeLessThan(before.origin[0])

    const tile = Object.values(nodes).find((node) => node.type === 'terrain-tile') as AnyNode & {
      heights: string
    }
    const edited = { ...tile, heights: `${tile.heights.slice(0, -8)}QUFBQQ==` }
    const tileNodes = { ...nodes, [tile.id]: edited as AnyNode }
    const tileField = persistedTerrainFieldOf(site, tileNodes)!
    expect(tileField).not.toBe(before)
    expect(persistedTerrainFieldOf(site, tileNodes)).toBe(tileField)

    const boundary = Object.values(nodes).find(
      (node) => node.type === 'terrain-break',
    ) as AnyNode & {
      left: number
    }
    const lowered = { ...boundary, left: boundary.left - 1 }
    const breakNodes = { ...nodes, [boundary.id]: lowered as AnyNode }
    const breakField = persistedTerrainFieldOf(site, breakNodes)!
    expect(breakField).not.toBe(before)
    // Inside the lowered ring the height is the new numeric side; the unedited field says the old.
    const [a, , c] = RING_A as [number, number][]
    const inside: [number, number] = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]
    expect(heightAt(breakField, ...inside)).toBe(boundary.left - 1)
    expect(heightAt(before, ...inside)).toBe(boundary.left)

    // The reused field reads what a field built from nothing reads.
    const fresh = scene()
    const rebuilt = persistedTerrainFieldOf(
      { ...fresh.site, children: [...fresh.site.children, 'x'] } as SiteNode,
      fresh.nodes,
    )!
    for (const [x, z] of probe) expect(heightAt(rebuilt, x, z)).toBe(heightAt(before, x, z))
  })
})
