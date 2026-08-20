import { describe, expect, test } from 'bun:test'
import { GutterNode } from '@pascal-app/core'
import { buildGutterGeometry } from './geometry'

describe('gutter UVs', () => {
  test('preserves metre scale along the gutter run', () => {
    const geometry = buildGutterGeometry(
      GutterNode.parse({
        id: 'gutter_uv',
        type: 'gutter',
        length: 4,
        hangerStyle: 'none',
      }),
    )
    const uv = geometry.getAttribute('uv')
    expect(geometry.getAttribute('uv2').count).toBe(uv.count)
    const values = Array.from({ length: uv.count }, (_, index) => [
      uv.getX(index),
      uv.getY(index),
    ]).flat()

    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThanOrEqual(3.9)
  })
})
