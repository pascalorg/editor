import { describe, expect, test } from 'bun:test'
import {
  RING_A,
  RING_C,
  terrainLagScene,
  terrainLagScenes,
} from './__fixtures__/terrain-lag-scenes'
import { heightAt } from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'

/*
 * Failure modes this file pins (the terrain lag, 15 Oct): the virtual ground's `heightBounds` was a
 * worst case over the slope, ±160 m for 6 m of relief on the owner's scene, so the lot's block
 * dropped to −168 m, every terrain raycast clipped against a 320 m tall box, and a bound that
 * is tight must still contain the ground:
 * - a bound that sits inside the sampled extremes clips terrain out of a raycast or a frustum;
 * - a bound far outside them costs the draw and the march;
 * - a legacy-only scene's bounds change.
 */

const smooth = { roughness: 0 }
const graded = [
  { line: RING_A, left: -3.8 as number | 'ground', right: 'ground' as number | 'ground' },
  { line: RING_C, left: -3.6 as number | 'ground', right: 'ground' as number | 'ground' },
]
// The owner's ground is graded smooth; the noisy scenes of the golden tests are rougher than it
// and the cliff has an eight-metre step on a shared tile border.
const scenes = [
  ...terrainLagScenes().filter((scene) => scene.name !== 'legacy only'),
  terrainLagScene('smooth, tiles only', smooth),
  terrainLagScene('smooth, rings', { ...smooth, breaks: graded }),
  terrainLagScene('smooth, legacy and rings', { ...smooth, legacy: true, breaks: graded }),
  terrainLagScene('cliff on an interior tile', { ...smooth, plateau: 8 }),
  terrainLagScene('cliff and rings', { ...smooth, plateau: 8, breaks: graded }),
]
const tight = (name: string) => name.startsWith('smooth') || name.startsWith('cliff')

function sampled(field: NonNullable<ReturnType<typeof persistedTerrainFieldOf>>) {
  const [ox, oz] = field.origin
  const maxX = ox + (field.cols - 1) * field.spacing
  const maxZ = oz + (field.rows - 1) * field.spacing
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let x = ox - 70; x <= maxX + 70; x += 1.7)
    for (let z = oz - 70; z <= maxZ + 70; z += 1.7) {
      const h = heightAt(field, x, z)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
    }
  return { lo, hi }
}

describe('the virtual ground’s height bounds are the ground’s', () => {
  test.each(scenes.map((scene) => [scene.name, scene] as const))(
    '%s: contain every sampled height and sit near the extremes',
    (_, scene) => {
      const field = persistedTerrainFieldOf(scene.site, scene.nodes)!
      const [lo, hi] = field.heightBounds!
      const real = sampled(field)
      expect(lo).toBeLessThanOrEqual(real.lo + 1e-9)
      expect(hi).toBeGreaterThanOrEqual(real.hi - 1e-9)
      // Ground blends the borders of every tile along an edge, so the border-by-border extreme
      // this bound takes is a little past the blended one: 2 m on ground this steep and this rough.
      const tolerance = tight(scene.name) ? 2 : 3.5
      expect(real.lo - lo).toBeLessThan(tolerance)
      expect(hi - real.hi).toBeLessThan(tolerance)
    },
  )

  test('a relief of −6…0 m is bounded by a few metres, not by 160', () => {
    const scene = scenes.find((entry) => entry.name === 'three rings, ground outside')!
    const [lo, hi] = persistedTerrainFieldOf(scene.site, scene.nodes)!.heightBounds!
    expect(lo).toBeGreaterThan(-12)
    expect(hi).toBeLessThan(6)
  })
})
