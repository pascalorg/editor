import { describe, expect, test } from 'bun:test'
import { LevelNode } from '../src/schema/nodes/level'

describe('LevelNode', () => {
  test('defaults baseElevation to 0', () => {
    const level = LevelNode.parse({
      level: 0,
      name: 'Ground',
    })

    expect(level.baseElevation).toBe(0)
  })

  test('accepts a custom baseElevation', () => {
    const level = LevelNode.parse({
      baseElevation: 1.25,
      level: 1,
      name: 'Split level',
    })

    expect(level.baseElevation).toBe(1.25)
  })
})
