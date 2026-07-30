// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { calculateLevelMiters, WallNode } from '@pascal-app/core'
import { generateExtrudedWall } from './wall-system'

describe('wall terrain bottom', () => {
  test('samples both faces independently without changing the authored body height', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 1,
      supportSlabId: 'ground',
      fillToTerrain: true,
    })
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      1.5,
      1.5,
      undefined,
      4,
      (_x, z) => (z >= 0 ? 0.2 : 0.8),
    )
    geometry.computeBoundingBox()

    const position = geometry.getAttribute('position')
    let positiveFaceMinY = Number.POSITIVE_INFINITY
    let negativeFaceMinY = Number.POSITIVE_INFINITY
    for (let index = 0; index < position.count; index += 1) {
      const z = position.getZ(index)
      const y = position.getY(index)
      if (z > 0.49) positiveFaceMinY = Math.min(positiveFaceMinY, y)
      if (z < -0.49) negativeFaceMinY = Math.min(negativeFaceMinY, y)
    }

    expect(positiveFaceMinY).toBeCloseTo(-1.3)
    expect(negativeFaceMinY).toBeCloseTo(-0.7)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.5)
    geometry.dispose()
  })
})
