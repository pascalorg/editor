import { describe, expect, test } from 'bun:test'
import { type AnyNodeId, WallNode } from '@pascal-app/core'
import { readHostWallCeiling, readHostWallCeilingMaxWidth } from './wall-opening-ceiling'

describe('readHostWallCeiling', () => {
  const wall = WallNode.parse({
    id: 'wall_test',
    start: [0, 0],
    end: [4, 0],
    height: 3,
  })
  const sloped = WallNode.parse({
    id: 'wall_sloped_ceiling',
    start: [0, 0],
    end: [10, 0],
    height: 3,
    endHeightOffset: -2,
  })
  const nodes = { [wall.id]: wall, [sloped.id]: sloped }
  const reader = { get: (id: AnyNodeId) => nodes[id], nodes: () => nodes }

  test('reads the flat wall ceiling', () => {
    expect(readHostWallCeiling(wall.id, reader)).toBe(3)
  })

  test('reads the lowest point of a sloped top over the opening span', () => {
    // Ceiling 3 - 0.2s: the span [4, 6] is lowest at s = 6.
    expect(
      readHostWallCeiling(sloped.id, reader, { position: [5, 1, 0], width: 2, height: 1 }),
    ).toBeCloseTo(1.8)
  })
})

describe('readHostWallCeilingMaxWidth', () => {
  const wallSloped = WallNode.parse({
    id: 'wall_sloped',
    start: [0, 0],
    end: [10, 0],
    height: 3,
    endHeightOffset: -2, // Slopes from 3m at start to 1m at end (slope = -0.2)
  })
  const nodes = { [wallSloped.id]: wallSloped }
  const reader = { get: (id: AnyNodeId) => nodes[id], nodes: () => nodes }

  test('calculates exact analytical max width growing towards low end', () => {
    // At anchorS = 2.0 (ceiling = 3 - 0.4 = 2.6m), growing right (growSign = +1)
    // topY = 2.0m. Limit where ceiling drops to 2.0m is s = (2.0 - 3.0)/(-0.2) = 5.0m
    // Allowed width = 5.0 - 2.0 = 3.0m
    const maxWidth = readHostWallCeilingMaxWidth(wallSloped.id, reader, 2.0, 1, 2.0, 10)
    expect(maxWidth).toBe(3.0)
  })

  test('allows full maxLength when growing towards high end', () => {
    // At anchorS = 5.0, growing left (growSign = -1) towards higher start
    const maxWidth = readHostWallCeilingMaxWidth(wallSloped.id, reader, 5.0, -1, 2.0, 4.0)
    expect(maxWidth).toBe(4.0)
  })

  test('returns 0 when anchor itself is below topY', () => {
    // At anchorS = 8.0, ceiling is 3 - 0.2*8 = 1.4m < topY (2.0m)
    const maxWidth = readHostWallCeilingMaxWidth(wallSloped.id, reader, 8.0, 1, 2.0, 5)
    expect(maxWidth).toBe(0)
  })
})
