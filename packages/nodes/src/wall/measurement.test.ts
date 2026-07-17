import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { matchWallMeasurementFeature } from './measurement'

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
})
