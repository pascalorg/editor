import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { clampToWall } from './door-math'

describe('clampToWall for doors', () => {
  test('centers at wallLength / 2 when door is wider than wall', () => {
    const wall = WallNode.parse({
      id: 'wall_short',
      start: [0, 0],
      end: [2, 0],
      height: 3,
    })
    const nodes = { [wall.id]: wall }
    const result = clampToWall(wall, 1, 3, 2.1, nodes)
    expect(result.clampedX).toBe(1) // wallLength / 2 = 2 / 2 = 1
    expect(result.clampedY).toBe(1.05) // height / 2 = 2.1 / 2 = 1.05
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
    const leftClamp = clampToWall(wall, 0.1, 1, 2.1, nodes)
    expect(leftClamp.clampedX).toBe(0.5)
    expect(leftClamp.fits).toBe(true)

    const rightClamp = clampToWall(wall, 4.9, 1, 2.1, nodes)
    expect(rightClamp.clampedX).toBe(4.5)
    expect(rightClamp.fits).toBe(true)
  })

  test('evaluates fits and slides on a sloped wall', () => {
    const wall = WallNode.parse({
      id: 'wall_sloped',
      start: [0, 0],
      end: [10, 0],
      height: 3,
      endHeightOffset: -2, // Slopes from 3m down to 1m (slope = -0.2)
    })
    const nodes = { [wall.id]: wall }

    // At X = 1 (near start), ceiling is ~2.8m -> 2.1m door fits
    const startResult = clampToWall(wall, 1, 1, 2.1, nodes)
    expect(startResult.fits).toBe(true)
    expect(startResult.clampedX).toBe(1)

    // At X = 9 (near end), ceiling is ~1.2m -> 2.1m door cannot fit
    // Exact analytical boundary: (2.1 - 3) / -0.2 - 0.5 = 4.0m
    const endResult = clampToWall(wall, 9, 1, 2.1, nodes)
    expect(endResult.fits).toBe(true)
    expect(endResult.clampedX).toBeCloseTo(4, 5)

    // Door taller than wall maximum height does not fit anywhere
    const tooTall = clampToWall(wall, 1, 1, 3.5, nodes)
    expect(tooTall.fits).toBe(false)
  })

  test('evaluates fits and slides on an upward sloped wall', () => {
    const wall = WallNode.parse({
      id: 'wall_upward',
      start: [0, 0],
      end: [10, 0],
      height: 1,
      endHeightOffset: 2, // Slopes from 1m up to 3m (slope = +0.2)
    })
    const nodes = { [wall.id]: wall }

    // At X = 1 (near start), ceiling is ~1.2m -> 2.1m door cannot fit
    // Exact analytical boundary: (2.1 - 1) / 0.2 + 0.5 = 6.0m
    const startResult = clampToWall(wall, 1, 1, 2.1, nodes)
    expect(startResult.fits).toBe(true)
    expect(startResult.clampedX).toBe(6)

    // At X = 8 (near end), ceiling is ~2.6m -> fits without sliding
    const endResult = clampToWall(wall, 8, 1, 2.1, nodes)
    expect(endResult.fits).toBe(true)
    expect(endResult.clampedX).toBe(8)
  })
})
