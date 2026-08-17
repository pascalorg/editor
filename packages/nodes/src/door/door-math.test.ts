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
      endHeightOffset: -2, // Slopes from 3m down to 1m
    })
    const nodes = { [wall.id]: wall }

    // At X = 1 (near start), ceiling is ~2.8m -> 2.1m door fits
    const startResult = clampToWall(wall, 1, 1, 2.1, nodes)
    expect(startResult.fits).toBe(true)

    // At X = 9 (near end), ceiling is ~1.2m -> 2.1m door cannot fit
    // It should slide left toward the taller start until it fits
    const endResult = clampToWall(wall, 9, 1, 2.1, nodes)
    expect(endResult.fits).toBe(true)
    expect(endResult.clampedX).toBeLessThan(5)
  })
})
