import { describe, expect, test } from 'bun:test'
import { measurementCentroid, pointInPolygon2D } from '@pascal-app/core'
import { measurementPolygonLabelAnchor, triangulateMeasurementPolygon } from './measurement-label'

describe('measurementPolygonLabelAnchor', () => {
  test('keeps a concave polygon label inside its visible fill', () => {
    const base = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 1],
      [1, 0, 1],
      [1, 0, 4],
      [0, 0, 4],
    ] as [number, number, number][]
    const centroid = measurementCentroid(base)
    const anchor = measurementPolygonLabelAnchor(base)

    expect(centroid).not.toBeNull()
    expect(
      pointInPolygon2D(
        [centroid![0], centroid![2]],
        base.map(([x, , z]) => [x, z]),
      ),
    ).toBe(false)
    expect(anchor).not.toBeNull()
    expect(
      pointInPolygon2D(
        [anchor![0], anchor![2]],
        base.map(([x, , z]) => [x, z]),
      ),
    ).toBe(true)
  })

  test('returns an on-plane anchor for a sloped polygon', () => {
    const base = [
      [0, 0, 0],
      [4, 2, 0],
      [4, 2, 4],
      [0, 0, 4],
    ] as [number, number, number][]
    const anchor = measurementPolygonLabelAnchor(base)

    expect(triangulateMeasurementPolygon(base)).toHaveLength(2)
    expect(anchor).not.toBeNull()
    expect(anchor![1]).toBeCloseTo(anchor![0] / 2)
  })
})
