import { describe, expect, test } from 'bun:test'
import { decodeTerrainField, heightAt } from '@pascal-app/core'
import {
  coarseHeightAt,
  DEFAULT_GRID_N,
  describeTerrainSample,
  fieldFromSamples,
  gridOver,
  localMetresToLngLat,
  MIN_RELIEF_M,
  type Pt,
  sampleLotTerrain,
} from './terrain'

// a 50 × 107 ft lot, x across, z into the lot
const LOT: Pt[] = [
  [0, 0],
  [15.24, 0],
  [15.24, 32.6],
  [0, 32.6],
]
const ORIGIN: [number, number] = [-121.4944, 38.5816]
const FT = 0.3048

/** A fake elevation route: the ground is a plane, `slopeFtPerM` feet per metre of x, `base` ft, optional holes. */
function fakeFetch(slopeFtPerM: number, base = 30, holeEvery = 0, fail = false): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { points: { lat: number; lng: number }[] }
    if (fail) return new Response(JSON.stringify({ ok: false, error: 'USGS down' }))
    // invert the projection the way the sampler projected: lng → x metres
    const results = body.points.map((p, i) => {
      const xM = (p.lng - ORIGIN[0]) * 364000 * Math.cos((ORIGIN[1] * Math.PI) / 180) * FT
      const elevation = holeEvery > 0 && i % holeEvery === 3 ? null : base + slopeFtPerM * xM
      return { lat: p.lat, lng: p.lng, elevation }
    })
    return new Response(JSON.stringify({ ok: true, results }))
  }) as typeof fetch
}

describe('grid and projection', () => {
  test('the grid pads the lot bbox and runs row-major; the projection inverts the plan frame', () => {
    const g = gridOver(LOT, 5)
    expect(g.n).toBe(5)
    expect(g.points).toHaveLength(25)
    expect(g.x0).toBeCloseTo(-15.24 * 0.08, 6)
    expect(g.x1).toBeCloseTo(15.24 * 1.08, 6)
    expect(g.points[0]).toEqual([g.x0, g.z0])
    expect(g.points[4]![0]).toBeCloseTo(g.x1, 9)
    expect(g.points[5]![1]).toBeCloseTo(g.z0 + (g.z1 - g.z0) / 4, 9)
    const ll = localMetresToLngLat([100 * FT, 200 * FT], ORIGIN)
    // 100 ft east, 200 ft south of the origin
    expect(ll.lat).toBeCloseTo(ORIGIN[1] - 200 / 364000, 9)
    expect(ll.lng).toBeCloseTo(
      ORIGIN[0] + 100 / (364000 * Math.cos((ORIGIN[1] * Math.PI) / 180)),
      9,
    )
  })

  test('bilinear reads interpolate the coarse grid and fill holes', () => {
    const g = gridOver(LOT, 3)
    const elev = g.points.map((p) => p[0]) // elevation = x
    expect(coarseHeightAt(g, elev, 7, 10, 0)).toBeCloseTo(7, 6)
    const holed = elev.map((v, i) => (i === 4 ? null : v))
    // the centre sample is a hole → the fill (the mean) stands in for it
    const mean = elev.reduce((s, v) => s + v, 0) / elev.length
    expect(coarseHeightAt(g, holed, (g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2, mean)).toBeCloseTo(
      mean,
      6,
    )
  })

  test('the heightfield follows the samples relative to the datum', () => {
    const g = gridOver(LOT, 5)
    const elevM = g.points.map((p) => 0.1 * p[0]) // 10 % grade in x, metres
    const field = fieldFromSamples(g, elevM, 0.1 * 7.62, 0)
    expect(heightAt(field, 7.62, 10)).toBeCloseTo(0, 2)
    expect(heightAt(field, 0, 10)).toBeCloseTo(-0.762, 2)
    expect(heightAt(field, 15, 5)).toBeCloseTo(0.738, 2)
    expect(field.cols).toBeLessThanOrEqual(129)
  })
})

describe('sampleLotTerrain', () => {
  test('a sloping lot writes a heightfield with the datum at the lot centre and says how much fall', async () => {
    const r = await sampleLotTerrain(LOT, ORIGIN, { fetchImpl: fakeFetch(0.3), now: () => 't' })
    expect(r.ok).toBe(true)
    expect(r.terrain).toBeDefined()
    expect(r.summary?.flat).toBe(false)
    expect(r.summary?.grid).toBe(DEFAULT_GRID_N)
    expect(r.summary?.sampled).toBe(81)
    // the datum is the ground at the lot centre (x = 7.62 m): 30 + 0.3 × 7.62 ft
    expect(r.summary?.datumFt).toBeCloseTo(30 + 0.3 * 7.62, 4)
    const field = decodeTerrainField(r.terrain)
    expect(field).not.toBeNull()
    // 0.3 ft per metre of x: 7.62 m west of the centre the ground is 2.29 ft lower
    expect(heightAt(field!, 0, 16.3)).toBeCloseTo(-0.3 * 7.62 * FT, 2)
    expect(heightAt(field!, 7.62, 16.3)).toBeCloseTo(0, 2)
    expect(heightAt(field!, 15.24, 16.3)).toBeCloseTo(0.3 * 7.62 * FT, 2)
  })

  test('a flat lot writes nothing; holes are counted; failures say why', async () => {
    const flat = await sampleLotTerrain(LOT, ORIGIN, { fetchImpl: fakeFetch(0.001) })
    expect(flat.ok).toBe(true)
    expect(flat.terrain).toBeUndefined()
    expect(flat.summary?.flat).toBe(true)
    expect(flat.summary!.reliefFt * FT).toBeLessThan(MIN_RELIEF_M)
    const holed = await sampleLotTerrain(LOT, ORIGIN, { fetchImpl: fakeFetch(0.3, 30, 7) })
    expect(holed.ok).toBe(true)
    expect(holed.summary!.holes).toBeGreaterThan(0)
    expect(holed.summary!.sampled + holed.summary!.holes).toBe(81)
    const down = await sampleLotTerrain(LOT, ORIGIN, { fetchImpl: fakeFetch(0.3, 30, 0, true) })
    expect(down.ok).toBe(false)
    expect(down.reason).toBe('USGS down')
    const thrown = await sampleLotTerrain(LOT, ORIGIN, {
      fetchImpl: (async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
    })
    expect(thrown.ok).toBe(false)
    expect(thrown.reason).toBe('offline')
    expect((await sampleLotTerrain([[0, 0]], ORIGIN)).reason).toBe('no lot ring')
  })

  test('the status fragment reads plainly', () => {
    expect(describeTerrainSample(null, 'USGS down')).toBe('terrain unavailable (USGS down)')
    expect(describeTerrainSample(null, 'skipped')).toBe('')
    expect(
      describeTerrainSample(
        {
          source: 'USGS EPQS',
          grid: 9,
          sampled: 79,
          holes: 2,
          datumFt: 30,
          reliefFt: 4.56,
          flat: false,
          at: 't',
        },
        '',
      ),
    ).toBe("terrain: 4.6' of fall across the lot (USGS, 79 pts, 2 unread)")
    expect(
      describeTerrainSample(
        {
          source: 'USGS EPQS',
          grid: 9,
          sampled: 81,
          holes: 0,
          datumFt: 30,
          reliefFt: 0.2,
          flat: true,
          at: 't',
        },
        '',
      ),
    ).toBe('ground flat within 2" (USGS)')
  })
})
