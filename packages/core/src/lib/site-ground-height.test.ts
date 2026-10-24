import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import { SiteNode } from '../schema'
import hillside from './__fixtures__/owner-hillside-grade.json'
import { FLAT_GROUND_Y, groundHeightAt } from './site-ground-height'
import { heightAt } from './terrain-field'
import { terrainFieldOf } from './terrain-source'

const nodes = hillside.nodes as unknown as Record<AnyNodeId, AnyNode>
const site = Object.values(nodes).find((node) => node.type === 'site') as AnyNode

describe('the height of the site’s ground at a point', () => {
  test('a flat site answers the plane its fill is drawn on, anywhere', () => {
    const flat = SiteNode.parse({ id: 'site_flat', children: [] })
    expect(groundHeightAt(flat, 0, 0)).toBe(FLAT_GROUND_Y)
    expect(groundHeightAt(flat, -400, 900)).toBe(FLAT_GROUND_Y)
  })

  test('no site is a flat site too', () => {
    expect(groundHeightAt(null, 3, 4)).toBe(FLAT_GROUND_Y)
  })

  test('a sculpted site answers the terrain as it reads there', () => {
    const field = terrainFieldOf(site as never)
    if (!field) throw new Error('the owner hillside has terrain')
    const probes: Array<[number, number]> = [
      [0, 0],
      [0, -14],
      [3, 9],
    ]
    for (const [x, z] of probes) expect(groundHeightAt(site, x, z)).toBe(heightAt(field, x, z))
    // The street side stands well over the pad the house sits on.
    expect(groundHeightAt(site, 0, -14)).toBeGreaterThan(groundHeightAt(site, 0, 0) + 2)
  })
})
