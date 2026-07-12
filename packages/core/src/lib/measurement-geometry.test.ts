import { describe, expect, test } from 'bun:test'
import type { MeasurementPoint } from '../schema/nodes/measurement'
import {
  areMeasurementPointsCoplanar,
  measurementArea,
  measurementAreaVector,
  measurementCentroid,
  measurementDistance,
  measurementNormal,
  measurementPrismVolume,
} from './measurement-geometry'

const expectPointCloseTo = (actual: MeasurementPoint | null, expected: MeasurementPoint) => {
  expect(actual).not.toBeNull()
  for (let index = 0; index < 3; index++) {
    expect(actual![index]!).toBeCloseTo(expected[index]!)
  }
}

describe('measurement geometry', () => {
  test('measures full 3D distance', () => {
    expect(measurementDistance([1, 2, 3], [4, 6, 15])).toBe(13)
  })

  test('computes a Newell area vector, area, and winding-aware normal', () => {
    const base: MeasurementPoint[] = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 1, 1],
      [0, 1, 1],
    ]

    expectPointCloseTo(measurementAreaVector(base), [0, -2, 2])
    expect(measurementArea(base)).toBeCloseTo(2 * Math.sqrt(2))
    expectPointCloseTo(measurementNormal(base), [0, -Math.SQRT1_2, Math.SQRT1_2])
    expectPointCloseTo(measurementNormal([...base].reverse()), [0, Math.SQRT1_2, -Math.SQRT1_2])
  })

  test('checks coplanarity against the Newell normal', () => {
    const base: MeasurementPoint[] = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 1, 1],
      [0, 1, 1],
    ]

    expect(areMeasurementPointsCoplanar(base)).toBe(true)
    expect(areMeasurementPointsCoplanar([...base, [1, 0.5, 0.51]])).toBe(false)
    expect(
      areMeasurementPointsCoplanar([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ]),
    ).toBe(false)
  })

  test('computes the area-weighted centroid of a planar 3D polygon', () => {
    expectPointCloseTo(
      measurementCentroid([
        [0, 0, 0],
        [2, 0, 0],
        [2, 1, 1],
        [0, 1, 1],
      ]),
      [1, 0.5, 0.5],
    )
  })

  test('computes area and centroid for a concave polygon', () => {
    const base: MeasurementPoint[] = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
      [1, 0, 2],
      [0, 0, 2],
    ]

    expect(measurementArea(base)).toBeCloseTo(3)
    expectPointCloseTo(measurementCentroid(base), [5 / 6, 0, 5 / 6])
  })

  test('computes prism volume from normal extrusion and ignores tangential extrusion', () => {
    const base: MeasurementPoint[] = [
      [0, 0, 0],
      [3, 0, 0],
      [3, 2, 0],
      [0, 2, 0],
    ]

    expect(measurementPrismVolume(base, [5, 7, 4])).toBeCloseTo(24)
    expect(measurementPrismVolume([...base].reverse(), [5, 7, 4])).toBeCloseTo(24)
  })
})
