import { describe, expect, test } from 'bun:test'
import {
  longestSegmentMidpoint,
  type PlanPoint,
  planLength,
  pointAtDistance,
  spacedLabelPoints,
} from '../geometry/labels'

const line = (length: number): PlanPoint[] => [
  [0, 0],
  [length, 0],
]

describe('2D label spacing', () => {
  test('measures a polyline by arc length across its corners', () => {
    expect(
      planLength([
        [0, 0],
        [3, 0],
        [3, 4],
      ]),
    ).toBeCloseTo(7, 10)
  })

  test('places one centred tag on a run shorter than the spacing', () => {
    const sites = spacedLabelPoints(line(6), 8, 1.2)
    expect(sites).toHaveLength(1)
    expect(sites[0]?.point[0]).toBeCloseTo(3, 10)
  })

  test('tags are spaced exactly `spacing` apart', () => {
    const sites = spacedLabelPoints(line(40), 8, 1.2)
    expect(sites.length).toBeGreaterThan(1)
    for (let i = 1; i < sites.length; i++) {
      const gap = (sites[i] as { distance: number }).distance -
        (sites[i - 1] as { distance: number }).distance
      expect(gap).toBeCloseTo(8, 10)
    }
  })

  test('leftover length is split evenly between the two ends', () => {
    const total = 40
    const margin = 1.2
    const sites = spacedLabelPoints(line(total), 8, margin)
    const first = sites[0]?.distance ?? 0
    const last = sites[sites.length - 1]?.distance ?? 0
    expect(first - margin).toBeCloseTo(total - margin - last, 10)
  })

  test('every tag stays inside the margins', () => {
    const margin = 1.2
    for (const total of [10, 17, 33, 41, 80]) {
      for (const site of spacedLabelPoints(line(total), 8, margin)) {
        expect(site.distance).toBeGreaterThanOrEqual(total <= 2 * margin + 8 ? 0 : margin - 1e-9)
        expect(site.distance).toBeLessThanOrEqual(total - (total <= 2 * margin + 8 ? 0 : margin) + 1e-9)
      }
    }
  })

  test('a zero-length or single-point run gets no tags', () => {
    expect(spacedLabelPoints([[2, 2]], 8, 1)).toEqual([])
    expect(
      spacedLabelPoints(
        [
          [2, 2],
          [2, 2],
        ],
        8,
        1,
      ),
    ).toEqual([])
  })

  test('tangents follow the segment the tag sits on', () => {
    const sites = spacedLabelPoints(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      6,
      0,
    )
    const onFirstLeg = sites.filter((site) => site.distance < 10)
    const onSecondLeg = sites.filter((site) => site.distance > 10)
    for (const site of onFirstLeg) expect(site.tangent).toEqual([1, 0])
    for (const site of onSecondLeg) expect(site.tangent).toEqual([0, 1])
  })

  test('pointAtDistance clamps past either end', () => {
    expect(pointAtDistance(line(10), -5)?.point[0]).toBeCloseTo(0, 10)
    expect(pointAtDistance(line(10), 99)?.point[0]).toBeCloseTo(10, 10)
  })

  test('the single overhead tag lands on the longest span', () => {
    const site = longestSegmentMidpoint([
      [0, 0],
      [2, 0],
      [22, 0],
      [24, 0],
    ])
    expect(site?.point[0]).toBeCloseTo(12, 10)
  })
})
