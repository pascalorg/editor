import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { isWallNudgeKey, WALL_NUDGE_IMPERIAL, wallNudgeDistance } from './wall-nudge'

const outside = { frontSide: 'exterior', backSide: 'interior' } as const
const wall = (id: string, start: [number, number], end: [number, number]) =>
  WallNode.parse({ id: `wall_${id}`, start, end, thickness: 0.15, ...outside })

describe('wallNudgeDistance', () => {
  const moving = wall('moving', [5, 0.3], [8, 0.3])

  test('an arrow across the wall moves it one inch that way', () => {
    const down = wallNudgeDistance(moving, [0, 1], [moving], WALL_NUDGE_IMPERIAL)
    const up = wallNudgeDistance(moving, [0, -1], [moving], WALL_NUDGE_IMPERIAL)
    expect(down).not.toBeNull()
    expect(up).not.toBeNull()
    // Signed along the move axis: both land 1 in from where the wall was, opposite ways.
    const move = (nudge: NonNullable<typeof down>) => nudge.axis[1] * nudge.distance
    expect(move(down!)).toBeCloseTo(0.0254, 10)
    expect(move(up!)).toBeCloseTo(-0.0254, 10)
  })

  test('an arrow along the wall does nothing', () => {
    expect(wallNudgeDistance(moving, [1, 0], [moving], WALL_NUDGE_IMPERIAL)).toBeNull()
    expect(wallNudgeDistance(moving, [-1, 0], [moving], WALL_NUDGE_IMPERIAL)).toBeNull()
  })

  test('stops flush with a parallel outside wall it would pass', () => {
    const top = wall('top', [0, 0.29], [4, 0.29])
    const nudge = wallNudgeDistance(moving, [0, -1], [moving, top], WALL_NUDGE_IMPERIAL)!
    expect(nudge.axis[1] * nudge.distance).toBeCloseTo(-0.01, 10)
  })

  test('a turned plan still picks the arrow nearest across the wall', () => {
    const turned = [Math.SQRT1_2, Math.SQRT1_2] as [number, number]
    const nudge = wallNudgeDistance(moving, turned, [moving], WALL_NUDGE_IMPERIAL)!
    expect(nudge.axis[1] * nudge.distance).toBeCloseTo(0.0254, 10)
  })
})

test('only the four bare arrows nudge', () => {
  expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].every(isWallNudgeKey)).toBe(true)
  expect(isWallNudgeKey('w')).toBe(false)
})
