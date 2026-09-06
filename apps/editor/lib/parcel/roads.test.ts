import { describe, expect, test } from 'bun:test'
import { METRES_PER_FOOT } from './project'
import { classOf, overpassQuery, parseOverpass, projectLngLat, widthFtForWay } from './roads'

// Sacramento — Land Park (PlanCrafters preset lot). 1° lat ≈ 364,000 ft.
const ORIGIN: [number, number] = [-121.480667, 38.553517]
const DEG_PER_M_LAT = 1 / (364000 * METRES_PER_FOOT)
const DEG_PER_M_LNG = DEG_PER_M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180)
/** A point `east` / `north` metres from the origin, as Overpass geometry. */
const at = (east: number, north: number) => ({
  lat: ORIGIN[1] + north * DEG_PER_M_LAT,
  lon: ORIGIN[0] + east * DEG_PER_M_LNG,
})

const fixture = {
  elements: [
    // the street in front: runs east-west 20 m north of the origin
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential', name: 'Castro Way' },
      geometry: [at(-80, 20), at(80, 20)],
    },
    // a sidewalk beside it, two nodes
    { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: [at(-80, 14), at(80, 14)] },
    // a wider road with an explicit width tag (metres) — rank puts it first
    {
      type: 'way',
      id: 3,
      tags: { highway: 'primary', name: 'Broadway', width: '18' },
      geometry: [at(-100, -90), at(100, -90)],
    },
    // three lanes and no width tag
    {
      type: 'way',
      id: 4,
      tags: { highway: 'secondary', lanes: '3' },
      geometry: [at(60, -100), at(60, 100)],
    },
    // not a highway class we lay
    { type: 'way', id: 5, tags: { highway: 'construction' }, geometry: [at(0, 0), at(10, 0)] },
    // a node, not a way
    { type: 'node', id: 6, lat: ORIGIN[1], lon: ORIGIN[0] },
    // far away — clipped
    {
      type: 'way',
      id: 7,
      tags: { highway: 'residential' },
      geometry: [at(900, 900), at(950, 900)],
    },
    // degenerate: one usable vertex
    {
      type: 'way',
      id: 8,
      tags: { highway: 'residential' },
      geometry: [at(0, 30), { lat: 'x', lon: 'y' }],
    },
  ],
}

describe('OSM roads', () => {
  test('classOf / widthFtForWay follow the class table, width tag and lanes', () => {
    expect(classOf({ highway: 'residential' })).toBe('residential')
    expect(classOf({ highway: 'construction' })).toBeNull()
    expect(classOf(undefined)).toBeNull()
    expect(widthFtForWay({ highway: 'residential' })).toBe(26)
    expect(widthFtForWay({ highway: 'primary', width: '18' })).toBeCloseTo(18 / METRES_PER_FOOT, 9)
    expect(widthFtForWay({ highway: 'secondary', lanes: '3' })).toBe(37) // 3 × 11 + 4 > 34
    expect(widthFtForWay({ highway: 'footway', lanes: '1' })).toBe(15) // never under the lane rule
    expect(widthFtForWay({ highway: 'service', width: '0.1' })).toBe(3) // floor
  })

  test('overpassQuery asks for highway ways around the point with the radius clamped', () => {
    const q = overpassQuery(38.553517, -121.480667, 220)
    expect(q).toContain('way["highway"](around:220,38.5535170,-121.4806670)')
    expect(q).toContain('out body geom')
    expect(overpassQuery(0, 0, 5)).toContain('around:40,')
    expect(overpassQuery(0, 0, 99999)).toContain('around:1500,')
  })

  test('projectLngLat: north is −z, east is +x, metres', () => {
    const [x, z] = projectLngLat([at(30, 20).lon, at(30, 20).lat], ORIGIN)
    expect(x).toBeCloseTo(30, 6)
    expect(z).toBeCloseTo(-20, 6)
  })

  test('parseOverpass projects the ways, keeps names, widths and class order, clips and skips junk', () => {
    const roads = parseOverpass(fixture, ORIGIN, { clipRadiusM: 250 })
    expect(roads.map((r) => r.id)).toEqual(['osm3', 'osm4', 'osm1', 'osm2'])
    const castro = roads.find((r) => r.name === 'Castro Way')!
    expect(castro.klass).toBe('residential')
    expect(castro.widthM).toBeCloseTo(26 * METRES_PER_FOOT, 9)
    expect(castro.oneway).toBe(false)
    expect(castro.centerline).toHaveLength(2)
    expect(castro.centerline[0]![0]).toBeCloseTo(-80, 5)
    expect(castro.centerline[0]![1]).toBeCloseTo(-20, 5)
    expect(castro.centerline[1]![0]).toBeCloseTo(80, 5)
    const broadway = roads.find((r) => r.name === 'Broadway')!
    expect(broadway.widthM).toBeCloseTo(18, 9)
    const lanes = roads.find((r) => r.id === 'osm4')!
    expect(lanes.name).toBe('')
    expect(lanes.widthM).toBeCloseTo(37 * METRES_PER_FOOT, 9)
  })

  test('garbage in, empty out', () => {
    expect(parseOverpass(null, ORIGIN)).toEqual([])
    expect(parseOverpass({ elements: 'nope' }, ORIGIN)).toEqual([])
    expect(
      parseOverpass(
        { elements: [{ type: 'way', id: 1, tags: { highway: 'residential' } }] },
        ORIGIN,
      ),
    ).toEqual([])
  })
})
