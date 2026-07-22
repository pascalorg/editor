// @ts-expect-error — bun:test is provided by the Bun runtime; nodes does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { buildWallPreviewGeometry } from './preview'

describe('wall placement preview', () => {
  test('uses the wall segment footprint instead of a generic box', () => {
    const geometry = buildWallPreviewGeometry({
      start: [1, 2],
      end: [5, 2],
      height: 3,
      thickness: 0.2,
    })
    const bounds = geometry.boundingBox!

    expect(bounds.max.x - bounds.min.x).toBeCloseTo(4)
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(3)
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.2)

    geometry.dispose()
  })
})
