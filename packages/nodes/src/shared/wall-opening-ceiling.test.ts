import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import {
  readHostWallCeiling,
  readHostWallCeilingMaxWidth,
  toWallCeilingSceneReader,
} from './wall-opening-ceiling'

describe('toWallCeilingSceneReader', () => {
  const wall = WallNode.parse({
    id: 'wall_test',
    start: [0, 0],
    end: [4, 0],
    height: 3,
  })
  const nodes = { [wall.id]: wall }

  test('normalizes a raw nodes record', () => {
    const reader = toWallCeilingSceneReader(nodes)
    expect(reader.get(wall.id)).toEqual(wall)
    expect(reader.nodes()).toEqual(nodes)
  })

  test('passes through an existing WallCeilingSceneReader untouched', () => {
    const existingReader = {
      get: (id: any) => nodes[id],
      nodes: () => nodes,
    }
    const reader = toWallCeilingSceneReader(existingReader)
    expect(reader).toBe(existingReader)
    expect(reader.get(wall.id)).toEqual(wall)
  })

  test('readHostWallCeiling works identically with both formats', () => {
    const fromRecord = readHostWallCeiling(wall.id, toWallCeilingSceneReader(nodes))
    const fromReader = readHostWallCeiling(wall.id, {
      get: (id: any) => nodes[id],
      nodes: () => nodes,
    })
    expect(fromRecord).toBe(3)
    expect(fromReader).toBe(3)
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
  const reader = toWallCeilingSceneReader(nodes)

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
