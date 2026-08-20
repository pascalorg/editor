import { describe, expect, test } from 'bun:test'
import { DownspoutNode } from '@pascal-app/core'
import { buildDownspoutGeometry } from './geometry'

describe('downspout geometry', () => {
  test('preserves metre scale along a straight run', () => {
    const geometry = buildDownspoutGeometry(
      DownspoutNode.parse({
        id: 'downspout_uv',
        type: 'downspout',
        length: 3,
        shape: 'rect',
        strapStyle: 'none',
        terminal: 'straight',
      }),
    )
    const uv = geometry.getAttribute('uv')
    expect(geometry.getAttribute('uv2').count).toBe(uv.count)
    const values = Array.from({ length: uv.count }, (_, index) => [
      uv.getX(index),
      uv.getY(index),
    ]).flat()

    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThanOrEqual(2.9)
  })
})
