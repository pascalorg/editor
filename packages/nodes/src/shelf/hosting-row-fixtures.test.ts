import { expect, test } from 'bun:test'
import { ShelfNode } from '@pascal-app/core'
import { shelfSurfaceRows } from '../../../core/src/services/__fixtures__/shelf-surface-rows'
import { shelfRowSurfaceYs } from './geometry'

for (const [key, rows] of Object.entries(shelfSurfaceRows))
  test(`core hosting row fixture matches production geometry: ${key}`, () => {
    const [style, withBottom, height, count, thickness] = key.split(',')
    const node = ShelfNode.parse({
      style,
      withBottom: withBottom === 'true',
      height: Number(height),
      rows: Number(count),
      thickness: Number(thickness),
    })
    expect(shelfRowSurfaceYs(node)).toEqual(rows)
  })
