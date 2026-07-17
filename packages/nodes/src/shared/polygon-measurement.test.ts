import { describe, expect, test } from 'bun:test'
import { measurementFeatureLength } from '@pascal-app/core'
import { closestMeasurementFeature, measurementFeaturePoint } from '../measurement/resolve'
import { polygonMeasurementFeatures } from './polygon-measurement'

describe('polygonMeasurementFeatures', () => {
  const features = polygonMeasurementFeatures({
    featurePrefix: 'slab',
    height: 0.2,
    label: 'Slab',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ],
  })

  test('exposes stable corners, the whole boundary, and center', () => {
    expect(features.map((feature) => feature.id)).toEqual([
      'slab:vertex:0',
      'slab:vertex:1',
      'slab:vertex:2',
      'slab:vertex:3',
      'slab:boundary',
      'slab:center',
    ])
    expect(measurementFeatureLength(features[4]!)).toBe(12)
    expect(features[5]!.geometry).toEqual({ kind: 'point', point: [2, 0.2, 1] })
  })

  test('binds by normalized perimeter position rather than vertex index', () => {
    const match = closestMeasurementFeature(features, [3, 0.2, 0.05], 0.1)
    expect(match?.feature.id).toBe('slab:boundary')
    expect(match?.parameters.t).toBeCloseTo(0.25)
    expect(
      measurementFeaturePoint(match!.feature, {
        nodeId: 'slab_test' as never,
        featureId: match!.feature.id,
        parameters: match!.parameters,
      }),
    ).toEqual([3, 0.2, 0])

    expect(
      measurementFeaturePoint(match!.feature, {
        nodeId: 'slab_test' as never,
        featureId: match!.feature.id,
        parameters: { t: 0.75 },
      }),
    ).toEqual([1, 0.2, 2])
  })

  test('keeps a corner binding on that corner when the polygon changes shape', () => {
    const match = closestMeasurementFeature(features, [4, 0.2, 0], 0.1)
    expect(match?.feature.id).toBe('slab:vertex:1')

    const resized = polygonMeasurementFeatures({
      featurePrefix: 'slab',
      height: 0.2,
      label: 'Slab',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 2],
        [0, 2],
      ],
    })
    const corner = resized.find((feature) => feature.id === match?.feature.id)
    expect(corner?.geometry).toEqual({ kind: 'point', point: [6, 0.2, 0] })
  })
})
