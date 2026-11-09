import { expect, test } from 'bun:test'
import { SlabNode, WallNode } from '../schema'
import { getRenderableSlabPolygon } from './slab-polygon'

test('stored plate rings are returned unchanged, including start rotation and winding', () => {
  const ring: [number, number][] = [
    [-0.1, -0.1],
    [4.1, -0.1],
    [4.1, 3.1],
    [-0.1, 3.1],
  ]
  const walls = [WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.6 })]
  for (const points of [ring, [...ring].reverse()])
    for (let i = 0; i < points.length; i++) {
      const slab = SlabNode.parse({
        polygon: [...points.slice(i), ...points.slice(0, i)],
        boundary: 'auto',
      })
      expect(getRenderableSlabPolygon(slab, { walls, siblingSlabs: [] })).toBe(slab.polygon)
    }
})
