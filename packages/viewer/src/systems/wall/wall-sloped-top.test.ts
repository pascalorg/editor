// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  MIN_WALL_END_HEIGHT,
  sceneRegistry,
  WallNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateExtrudedWall, wallTopYAt } from './wall-system'

describe('sloped wall top', () => {
  test('follows the slope inside the wall and never drops below the minimum end height', () => {
    const falling = { height: 2.5, slope: -(2.5 - MIN_WALL_END_HEIGHT) / 2 }
    expect(wallTopYAt(falling, 0)).toBeCloseTo(2.5, 9)
    expect(wallTopYAt(falling, 1)).toBeCloseTo(1.255, 9)
    expect(wallTopYAt(falling, 2)).toBeCloseTo(MIN_WALL_END_HEIGHT, 9)
    expect(wallTopYAt(falling, 2.4)).toBe(MIN_WALL_END_HEIGHT)

    const rising = { height: 0.2, slope: 3 }
    expect(wallTopYAt(rising, -0.5)).toBe(MIN_WALL_END_HEIGHT)
    expect(wallTopYAt(rising, 1)).toBeCloseTo(3.2, 9)

    expect(wallTopYAt({ height: 0.005, slope: -1 }, 1)).toBe(0.005)
    expect(wallTopYAt({ height: 2, slope: 0 }, -10)).toBe(2)
  })

  test('keeps a mitered corner extended past the low end above the wall base', () => {
    const wall = WallNode.parse({
      id: 'wall_steep-slope-miter',
      start: [0, 0],
      end: [2, 0],
      height: 2.5,
      endHeightOffset: -(2.5 - MIN_WALL_END_HEIGHT),
      thickness: 0.3,
    })
    // An acute corner at the low end pushes one face's miter vertex well past x = 2.
    const neighbour = WallNode.parse({
      id: 'wall_steep-slope-neighbour',
      start: [2, 0],
      end: [0, 0.6],
      height: 2.5,
      thickness: 0.3,
    })
    sceneRegistry.nodes.set(wall.id, new THREE.Mesh())
    try {
      const geometry = generateExtrudedWall(wall, [], calculateLevelMiters([wall, neighbour]))
      const position = geometry.getAttribute('position')
      let maxX = -Infinity
      let minY = Infinity
      for (let i = 0; i < position.count; i++) {
        maxX = Math.max(maxX, position.getX(i))
        minY = Math.min(minY, position.getY(i))
      }
      expect(maxX).toBeGreaterThan(2.1)
      expect(minY).toBeGreaterThanOrEqual(-1e-6)
      geometry.dispose()
    } finally {
      sceneRegistry.nodes.delete(wall.id)
    }
  })
})
