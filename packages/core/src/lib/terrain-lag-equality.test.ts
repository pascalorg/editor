import { describe, expect, test } from 'bun:test'
import golden from './__fixtures__/terrain-lag-golden.json'
import goldenSides from './__fixtures__/terrain-lag-golden-sides.json'
import { terrainLagPoints, terrainLagScenes } from './__fixtures__/terrain-lag-scenes'
import { terrainBreakHeightAt } from './terrain-breaks'
import { heightAt } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

/*
 * Failure modes this file pins (the terrain lag, 15 Oct): the authority's reads were made fast
 * without changing a result. The golden heights are what the build before the speed-up read, to
 * the last bit, on scenes shaped like the owner's (tiles, closed and open breaks, a legacy field).
 * - a read takes a different tile, triangle or region than it did, and a height moves;
 * - the cache that keeps one authority per site returns the field of another set of tiles or breaks;
 * - a legacy-only scene's bounds change.
 */

const scenes = terrainLagScenes()

describe('the authority reads what it read before the speed-up', () => {
  test.each(scenes.map((scene) => [scene.name, scene] as const))(
    '%s: every sampled height is the same',
    (name, scene) => {
      const field = persistedTerrainFieldOf(scene.site, scene.nodes)
      expect(field).not.toBeNull()
      const expected = (golden.heights as Record<string, number[]>)[name]!
      const points = terrainLagPoints(scene)
      expect(points).toHaveLength(expected.length)
      const wrong: string[] = []
      points.forEach(([x, z], index) => {
        const value = heightAt(field!, x, z)
        if (value !== expected[index]) wrong.push(`(${x}, ${z}): ${value} ≠ ${expected[index]}`)
      })
      expect(wrong).toEqual([])
    },
  )

  test.each(
    scenes
      .filter((scene) => scene.rings.length || scene.open)
      .map((scene) => [scene.name, scene] as const),
  )('%s: the ground each side of a break reads the same, refusals included', (name, scene) => {
    const field = persistedTerrainFieldOf(scene.site, scene.nodes)!
    const expected = (goldenSides as Record<string, (number | string)[]>)[name]!
    const points = terrainLagPoints(scene).filter((_, index) => index % 3 === 0)
    const read: (number | string)[] = []
    for (const boundary of field.terrainBreaks ?? [])
      for (const side of ['left', 'right'] as const)
        for (const [x, z] of points) {
          try {
            read.push(terrainBreakHeightAt(field, boundary, side, x, z))
          } catch (error) {
            read.push(`refused: ${(error as Error).message}`)
          }
        }
    expect(read).toEqual(expected)
  })

  test('a legacy-only scene keeps its exact bounds', () => {
    const scene = scenes.find((entry) => entry.name === 'legacy only')!
    expect(persistedTerrainFieldOf(scene.site, scene.nodes)?.heightBounds).toEqual(
      golden.legacyOnlyBounds as [number, number],
    )
  })
})
