import { describe, expect, test } from 'bun:test'
import {
  catenaryParameterForSag,
  catenarySag,
  polylineLength,
  runLength,
  sampleCatenarySpan,
  sampleOverheadPath,
  type Vec3,
} from '../geometry/catenary'

describe('catenary sag geometry', () => {
  test('solves the catenary parameter that produces a requested sag', () => {
    const span = 30
    const sag = span * 0.015
    const a = catenaryParameterForSag(span, sag)
    expect(catenarySag(span, a)).toBeCloseTo(sag, 6)
  })

  test('a zero sag degenerates to a straight line', () => {
    expect(catenaryParameterForSag(20, 0)).toBe(Number.POSITIVE_INFINITY)
    const points = sampleCatenarySpan([0, 6, 0], [20, 6, 0], 0, 8)
    for (const point of points) expect(point[1]).toBeCloseTo(6, 10)
  })

  test('endpoints stay exactly on their attachments', () => {
    const from: Vec3 = [0, 10, 0]
    const to: Vec3 = [24, 4.5, 7]
    const points = sampleCatenarySpan(from, to, 0.015, 16)
    expect(points).toHaveLength(17)
    expect(points[0]).toEqual(from)
    const last = points[points.length - 1] as Vec3
    expect(last[0]).toBeCloseTo(to[0], 10)
    expect(last[1]).toBeCloseTo(to[1], 10)
    expect(last[2]).toBeCloseTo(to[2], 10)
  })

  test('mid-span drop equals sagRatio × the horizontal span', () => {
    const span = 40
    const ratio = 0.015
    const points = sampleCatenarySpan([0, 8, 0], [span, 8, 0], ratio, 40)
    const mid = points[20] as Vec3
    expect(8 - mid[1]).toBeCloseTo(span * ratio, 6)
  })

  test('sag is measured on the HORIZONTAL span, not the inclined chord', () => {
    // Same horizontal run, one level and one dropping 5 m: identical sag.
    const level = sampleCatenarySpan([0, 10, 0], [20, 10, 0], 0.02, 20)
    const inclined = sampleCatenarySpan([0, 10, 0], [20, 5, 0], 0.02, 20)
    const levelDrop = 10 - (level[10] as Vec3)[1]
    const inclinedDrop = 7.5 - (inclined[10] as Vec3)[1]
    expect(levelDrop).toBeCloseTo(0.4, 6)
    expect(inclinedDrop).toBeCloseTo(0.4, 6)
  })

  test('a sagged cable is longer than its chord', () => {
    const chord = 30
    const sagged = polylineLength(sampleCatenarySpan([0, 8, 0], [chord, 8, 0], 0.015, 64))
    expect(sagged).toBeGreaterThan(chord)
    // 1.5% sag on a level span costs about 0.06% extra wire.
    expect(sagged / chord).toBeLessThan(1.002)
  })

  test('a longer span sags further in absolute terms at the same ratio', () => {
    const short = sampleCatenarySpan([0, 9, 0], [10, 9, 0], 0.015, 20)
    const long = sampleCatenarySpan([0, 9, 0], [40, 9, 0], 0.015, 20)
    expect(9 - (short[10] as Vec3)[1]).toBeCloseTo(0.15, 6)
    expect(9 - (long[10] as Vec3)[1]).toBeCloseTo(0.6, 6)
  })

  test('a multi-span run does not duplicate its joints', () => {
    const path: Vec3[] = [
      [0, 9, 0],
      [20, 9, 0],
      [40, 5, 0],
    ]
    const sampled = sampleOverheadPath(path, 0.015, 8)
    expect(sampled).toHaveLength(17)
    // The joint appears exactly once, at its stored elevation.
    const joint = sampled[8] as Vec3
    expect(joint[0]).toBeCloseTo(20, 6)
    expect(joint[1]).toBeCloseTo(9, 6)
  })

  test('runLength uses the sagged length overhead and the straight length buried', () => {
    const path: Vec3[] = [
      [0, 6, 0],
      [30, 6, 0],
    ]
    expect(runLength(path, 'underground', 0.015)).toBeCloseTo(30, 6)
    expect(runLength(path, 'overhead', 0.015)).toBeGreaterThan(30)
  })

  test('buried length counts the vertical drop into the trench', () => {
    const path: Vec3[] = [
      [0, 0, 0],
      [0, -0.75, 0],
      [10, -0.75, 0],
    ]
    expect(runLength(path, 'underground', 0.015)).toBeCloseTo(10.75, 6)
  })
})
