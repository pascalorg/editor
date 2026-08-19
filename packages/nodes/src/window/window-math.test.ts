import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { clampToWall } from './window-math'

describe('clampToWall for windows', () => {
  test('centers at wallLength / 2 when window is wider than wall', () => {
    const wall = WallNode.parse({
      id: 'wall_short',
      start: [0, 0],
      end: [2, 0],
      height: 3,
    })
    const nodes = { [wall.id]: wall }
    const result = clampToWall(wall, 1, 1.5, 3, 1.2, nodes)
    expect(result.clampedX).toBe(1) // wallLength / 2 = 2 / 2 = 1
    expect(result.clampedY).toBe(0.6) // height / 2 = 1.2 / 2 = 0.6
    expect(result.fits).toBe(false)
  })

  test('clamps within horizontal bounds on a standard wall', () => {
    const wall = WallNode.parse({
      id: 'wall_standard',
      start: [0, 0],
      end: [5, 0],
      height: 3,
    })
    const nodes = { [wall.id]: wall }
    const leftClamp = clampToWall(wall, 0.1, 1.5, 1, 1.2, nodes)
    expect(leftClamp.clampedX).toBe(0.5)
    expect(leftClamp.clampedY).toBe(1.5)
    expect(leftClamp.fits).toBe(true)

    const rightClamp = clampToWall(wall, 4.9, 1.5, 1, 1.2, nodes)
    expect(rightClamp.clampedX).toBe(4.5)
    expect(rightClamp.clampedY).toBe(1.5)
    expect(rightClamp.fits).toBe(true)
  })

  test('clamps Y against sloped ceiling while preserving sill height', () => {
    const wall = WallNode.parse({
      id: 'wall_sloped',
      start: [0, 0],
      end: [10, 0],
      height: 3,
      endHeightOffset: -1.5, // Slopes from 3m down to 1.5m
    })
    const nodes = { [wall.id]: wall }

    // At X = 8, window span is [7.5, 8.5].
    // Ceiling at lowest right edge (t = 8.5/10) is 3 - 1.5 * 0.85 = 1.725m.
    // Window ceiling top is clamped to 1.725m -> clamped Y = 1.725 - 0.5 = 1.225m.
    const result = clampToWall(wall, 8, 2.0, 1.0, 1.0, nodes)
    expect(result.fits).toBe(true)
    expect(result.clampedX).toBe(8)
    expect(result.clampedY).toBeCloseTo(1.225, 3)
  })
})
