import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import {
  matchWallMeasurementFeature,
  resolveWallMeasurementFeature,
  wallMeasurementFeatures,
} from './measurement'

describe('matchWallMeasurementFeature', () => {
  test('keeps an exact plan corner bound to the wall endpoint instead of its face', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2 })

    expect(matchWallMeasurementFeature(wall, [4, 0, 0], 0.2)).toMatchObject({
      featureId: 'wall:end',
      point: [4, 0, 0],
    })
  })

  test('keeps elevated 3D hits on the wall face matcher', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2 })

    expect(matchWallMeasurementFeature(wall, [4, 1, 0.1], 0.2)?.featureId).toBe('wall:face:left')
  })

  test('publishes a stable center feature only for curved walls', () => {
    const curved = WallNode.parse({ start: [0, 0], end: [4, 0], curveOffset: 1 })
    const straight = WallNode.parse({ start: [0, 0], end: [4, 0] })

    expect(
      wallMeasurementFeatures(curved).find((feature) => feature.id === 'wall:curve:center'),
    ).toMatchObject({
      snapKind: 'center',
      geometry: { kind: 'point', point: [2, 0, 1.5] },
    })
    expect(
      wallMeasurementFeatures(straight).find((feature) => feature.id === 'wall:curve:center'),
    ).toBeUndefined()
  })

  test('resolves the curved-wall center from the current wall shape', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], curveOffset: 0.5 })

    expect(
      resolveWallMeasurementFeature(wall, {
        nodeId: wall.id,
        featureId: 'wall:curve:center',
      }),
    ).toMatchObject({ geometry: { kind: 'point', point: [2, 0, 3.75] } })
  })
})
