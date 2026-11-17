// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  createTerrainField,
  encodeTerrainField,
  heightAt,
  persistedTerrainFieldOf,
  SiteNode,
  TerrainTileNode,
  WallNode,
} from '@pascal-app/core'
import { generateExtrudedWall } from './wall-system'

describe('wall terrain bottom', () => {
  test('a wall spanning a tile edge uses the overlay instead of the frozen legacy base', () => {
    const base = createTerrainField({ cols: 129, rows: 65, spacing: 0.5 })
    base.heights.fill(-100)
    const site = SiteNode.parse({ id: 'site_wall', terrain: encodeTerrainField(base) })
    const tiles = [0, 1].map((ix) => {
      const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
      field.heights.fill(50)
      return TerrainTileNode.parse({
        id: `terrain-tile_wall_${ix}`,
        parentId: site.id,
        level: 0,
        ix,
        iz: 0,
        step: 0.01,
        heights: encodeTerrainField(field).heights,
      })
    })
    const nodes = { [site.id]: site, ...Object.fromEntries(tiles.map((tile) => [tile.id, tile])) }
    const field = persistedTerrainFieldOf(site, nodes)
    if (!field) throw new Error('Missing tiled ground')
    const wall = WallNode.parse({
      start: [30, 16],
      end: [34, 16],
      height: 2.5,
      thickness: 1,
      supportSlabId: 'ground',
      fillToTerrain: true,
    })
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      1.5,
      1.5,
      undefined,
      4,
      (x, z) => heightAt(field, x, z),
    )
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.y).toBeCloseTo(-1, 6)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.5, 6)
    geometry.dispose()
  })

  test('samples both faces independently without changing the authored body height', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 1,
      supportSlabId: 'ground',
      fillToTerrain: true,
    })
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      1.5,
      1.5,
      undefined,
      4,
      (_x, z) => (z >= 0 ? 0.2 : 0.8),
    )
    geometry.computeBoundingBox()

    const position = geometry.getAttribute('position')
    let positiveFaceMinY = Number.POSITIVE_INFINITY
    let negativeFaceMinY = Number.POSITIVE_INFINITY
    for (let index = 0; index < position.count; index += 1) {
      const z = position.getZ(index)
      const y = position.getY(index)
      if (z > 0.49) positiveFaceMinY = Math.min(positiveFaceMinY, y)
      if (z < -0.49) negativeFaceMinY = Math.min(negativeFaceMinY, y)
    }

    expect(positiveFaceMinY).toBeCloseTo(-1.3)
    expect(negativeFaceMinY).toBeCloseTo(-0.7)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.5)
    geometry.dispose()
  })
})
