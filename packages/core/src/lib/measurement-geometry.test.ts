import { describe, expect, test } from 'bun:test'
import type { MeasurementFeature } from '../registry/types'
import type { MeasurementAnchor, MeasurementPoint } from '../schema/nodes/measurement'
import {
  areMeasurementPointsCoplanar,
  closestMeasurementFeatureBinding,
  measurementAnchorReferenceNodeIds,
  measurementAngle,
  measurementArea,
  measurementAreaVector,
  measurementCentroid,
  measurementDistance,
  measurementNormal,
  measurementPerimeter,
  measurementPrismVolume,
  remapMeasurementAnchors,
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

  test('measures the smaller 3D angle and a closed perimeter', () => {
    expect(measurementAngle([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2)
    expect(measurementAngle([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBe(0)
    expect(
      measurementPerimeter([
        [0, 0, 0],
        [3, 0, 0],
        [3, 0, 4],
      ]),
    ).toBe(12)
  })

  test('matches the closest semantic feature with a normalized path position', () => {
    const features: MeasurementFeature[] = [
      {
        id: 'boundary',
        label: 'Boundary',
        snapKind: 'edge',
        geometry: {
          kind: 'polygon',
          points: [
            [0, 0, 0],
            [2, 0, 0],
            [2, 0, 2],
            [0, 0, 2],
          ],
        },
      },
    ]

    const match = closestMeasurementFeatureBinding(features, [1.9, 0, 1], 0.2)

    expect(match?.featureId).toBe('boundary')
    expect(match?.point).toEqual([2, 0, 1])
    expect(match?.parameters?.t).toBeCloseTo(0.375)
    expect(match?.distance).toBeCloseTo(0.1)
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

  test('remaps and collects references for arbitrary anchor strings', () => {
    const anchors: MeasurementAnchor[] = [
      {
        kind: 'feature',
        reference: { nodeId: 'wall_a', featureId: 'wall:start' },
        fallback: [0, 0, 0],
      },
      [2, 0, 0],
      {
        kind: 'feature',
        reference: { nodeId: 'wall_b', featureId: 'wall:end' },
        fallback: [4, 0, 0],
      },
    ]

    expect(measurementAnchorReferenceNodeIds(anchors)).toEqual(['wall_a', 'wall_b'])
    const remapped = remapMeasurementAnchors(
      anchors,
      new Map([
        ['wall_a', 'wall_a_copy'],
        ['wall_b', 'wall_b_copy'],
      ]),
    )
    const first = remapped[0]!
    const last = remapped[2]!
    expect(Array.isArray(first) ? null : first.reference.nodeId).toBe('wall_a_copy')
    expect(Array.isArray(last) ? null : last.reference.nodeId).toBe('wall_b_copy')
  })
})
