import { describe, expect, test } from 'bun:test'
import { ConveyorBeltNode } from './conveyor-belt'

describe('ConveyorBeltNode', () => {
  test('parses a multi-segment conveyor route', () => {
    const node = ConveyorBeltNode.parse({
      name: 'Line A',
      points: [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 3],
      ],
    })

    expect(node.type).toBe('conveyor-belt')
    expect(node.points).toHaveLength(3)
    expect(node.color).toBe('#111827')
    expect(node.edgeColor).toBe('#94a3b8')
    expect(node.rollerColor).toBe('#cbd5e1')
    expect(node.direction).toBe('forward')
  })

  test('requires at least two route points', () => {
    expect(() =>
      ConveyorBeltNode.parse({
        name: 'Invalid',
        points: [[0, 0, 0]],
      }),
    ).toThrow()
  })
})
