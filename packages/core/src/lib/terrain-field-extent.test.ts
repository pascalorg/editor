import { describe, expect, test } from 'bun:test'
import type { SiteNode } from '../schema'
import { DEFAULT_TERRAIN_SPACING } from './terrain-field'
import { fieldExtentForSite } from './terrain-field-extent'

function site(points: Array<[number, number]>): SiteNode {
  return {
    id: 'site_1',
    type: 'site',
    children: [],
    polygon: { type: 'polygon', points },
  } as unknown as SiteNode
}

describe('fieldExtentForSite', () => {
  test('covers the whole polygon with padding to spare', () => {
    const extent = fieldExtentForSite(
      site([
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ]),
    )
    const maxX = extent.origin[0] + (extent.cols - 1) * extent.spacing
    const maxZ = extent.origin[1] + (extent.rows - 1) * extent.spacing

    // Strictly outside the lot on all four sides: the field must not end at the
    // property line, or the terrain mesh stops exactly where the boundary is
    // drawn and leaves a visible cliff.
    expect(extent.origin[0]).toBeLessThan(-10)
    expect(extent.origin[1]).toBeLessThan(-10)
    expect(maxX).toBeGreaterThan(10)
    expect(maxZ).toBeGreaterThan(10)
  })

  test('is square and 2ⁿ+1 so a future LOD halving lands on real samples', () => {
    for (const half of [4, 12, 30, 80]) {
      const extent = fieldExtentForSite(
        site([
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ]),
      )
      expect(extent.cols).toBe(extent.rows)
      expect([33, 65, 129, 257]).toContain(extent.cols)
    }
  })

  test('centres on the lot even when the lot is off-origin', () => {
    const extent = fieldExtentForSite(
      site([
        [100, 40],
        [120, 40],
        [120, 60],
        [100, 60],
      ]),
    )
    const centerX = extent.origin[0] + ((extent.cols - 1) / 2) * extent.spacing
    const centerZ = extent.origin[1] + ((extent.rows - 1) / 2) * extent.spacing
    expect(centerX).toBeCloseTo(110, 6)
    expect(centerZ).toBeCloseTo(50, 6)
  })

  test('holds the default spacing while the lot fits in 257 samples', () => {
    const extent = fieldExtentForSite(
      site([
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ]),
    )
    expect(extent.spacing).toBeCloseTo(DEFAULT_TERRAIN_SPACING, 6)
  })

  test('stretches spacing rather than stopping short on a huge lot', () => {
    // A 400 m lot needs 801 samples at 0.5 m. Capping the sample count and
    // coarsening is the right trade: coarse ground everywhere beats fine ground
    // that ends mid-lot.
    const extent = fieldExtentForSite(
      site([
        [-200, -200],
        [200, -200],
        [200, 200],
        [-200, 200],
      ]),
    )
    expect(extent.cols).toBe(257)
    expect(extent.spacing).toBeGreaterThan(DEFAULT_TERRAIN_SPACING)
    const maxX = extent.origin[0] + (extent.cols - 1) * extent.spacing
    expect(maxX).toBeGreaterThan(200)
  })

  test('a degenerate polygon still yields a usable field', () => {
    for (const points of [[], [[0, 0]] as Array<[number, number]>]) {
      const extent = fieldExtentForSite(site(points as Array<[number, number]>))
      expect(extent.cols).toBe(65)
      expect(extent.spacing).toBeCloseTo(DEFAULT_TERRAIN_SPACING, 6)
    }
  })

  test('a null site does not throw', () => {
    expect(fieldExtentForSite(null).cols).toBe(65)
    expect(fieldExtentForSite(undefined).cols).toBe(65)
  })
})
