import { describe, expect, test } from 'bun:test'
import { StairNode } from './stair'

describe('StairNode schema', () => {
  test('defaults spiral center columns to round', () => {
    const stair = StairNode.parse({ stairType: 'spiral' })
    expect(stair.centerColumnShape).toBe('round')
  })

  test('accepts square spiral center columns', () => {
    const stair = StairNode.parse({ stairType: 'spiral', centerColumnShape: 'square' })
    expect(stair.centerColumnShape).toBe('square')
  })

  test('rejects unknown center column shapes', () => {
    expect(() => StairNode.parse({ centerColumnShape: 'triangle' })).toThrow()
  })
})
