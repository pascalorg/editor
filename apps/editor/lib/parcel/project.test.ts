import { describe, expect, it } from 'bun:test'
import {
  FEET_PER_DEG_LAT,
  METRES_PER_FOOT,
  outerRingMetres,
  planFeetToMetres,
  polygonArea,
  type Ring,
  ringsToPlanFeet,
} from './project'

describe('ringsToPlanFeet', () => {
  it('puts the origin at (0,0) and points x east / y south', () => {
    const origin: [number, number] = [-82.5, 27.92]
    const east: Ring = [
      [-82.5, 27.92],
      [-82.4999, 27.92],
      [-82.4999, 27.9201],
    ]
    const [ring] = ringsToPlanFeet([east], origin)
    expect(ring?.[0]?.[0]).toBeCloseTo(0, 9)
    expect(ring?.[0]?.[1]).toBeCloseTo(0, 9)
    // One ten-thousandth of a degree east is positive x.
    expect(ring?.[1]?.[0]).toBeGreaterThan(0)
    expect(ring?.[1]?.[1]).toBeCloseTo(0, 6)
    // North (increasing latitude) is NEGATIVE y — y runs south.
    expect(ring?.[2]?.[1]).toBeLessThan(0)
  })

  it('scales latitude by 364,000 ft/deg and longitude by cos(lat)', () => {
    const origin: [number, number] = [0, 60] // cos(60°) = 0.5 exactly
    const [ring] = ringsToPlanFeet(
      [
        [
          [0, 60],
          [1, 60],
          [0, 61],
        ],
      ],
      origin,
    )
    expect(ring?.[1]?.[0]).toBeCloseTo(FEET_PER_DEG_LAT * 0.5, 3)
    expect(ring?.[2]?.[1]).toBeCloseTo(-FEET_PER_DEG_LAT, 6)
  })

  it('drops rings with fewer than three usable vertices and bad coordinates', () => {
    const rings = ringsToPlanFeet(
      [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [0, 0],
          [Number.NaN, 0],
          [1, 1],
          [0, 1],
        ],
      ],
      [0, 0],
    )
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(3)
  })

  it('returns nothing for a non-finite origin', () => {
    expect(ringsToPlanFeet([[[0, 0]]], [Number.NaN, 0])).toEqual([])
  })
})

describe('planFeetToMetres', () => {
  it('converts with the international foot', () => {
    expect(planFeetToMetres([[100, -50]])).toEqual([[100 * METRES_PER_FOOT, -50 * METRES_PER_FOOT]])
    expect(planFeetToMetres([[1, 0]])[0]?.[0]).toBeCloseTo(0.3048, 12)
  })
})

describe('outerRingMetres', () => {
  it('takes ring 0, converts to metres, and drops the closing vertex', () => {
    const feet = [
      [
        [0, 0],
        [100, 0],
        [100, 80],
        [0, 80],
        [0, 0],
      ],
    ] as [number, number][][]
    const m = outerRingMetres(feet)
    expect(m).toHaveLength(4)
    expect(m[2]?.[0]).toBeCloseTo(100 * METRES_PER_FOOT, 12)
    expect(m[2]?.[1]).toBeCloseTo(80 * METRES_PER_FOOT, 12)
  })

  it('drops consecutive duplicate vertices', () => {
    const m = outerRingMetres([
      [
        [0, 0],
        [10, 0],
        [10, 0],
        [10, 10],
      ],
    ])
    expect(m).toHaveLength(3)
  })

  it('is empty for a degenerate ring', () => {
    expect(outerRingMetres([])).toEqual([])
    expect(
      outerRingMetres([
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toEqual([])
  })
})

describe('end-to-end area', () => {
  it('a lng/lat ring projects to a polygon whose metric area matches its sq-ft area', () => {
    // ~10,000 sq ft lot near Tampa: 100 ft × 100 ft.
    const lat = 27.9224
    const lng = -82.5021
    const ftPerDegLat = FEET_PER_DEG_LAT
    const ftPerDegLng = FEET_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
    const dLat = 100 / ftPerDegLat
    const dLng = 100 / ftPerDegLng
    const rings: Ring[] = [
      [
        [lng, lat],
        [lng + dLng, lat],
        [lng + dLng, lat + dLat],
        [lng, lat + dLat],
      ],
    ]
    const feet = ringsToPlanFeet(rings, [lng, lat])
    expect(polygonArea(feet[0] as [number, number][])).toBeCloseTo(10000, 3)
    const metres = outerRingMetres(feet)
    expect(polygonArea(metres)).toBeCloseTo(10000 * METRES_PER_FOOT * METRES_PER_FOOT, 3)
  })
})
