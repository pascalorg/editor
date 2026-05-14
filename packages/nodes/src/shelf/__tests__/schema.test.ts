import { describe, expect, test } from 'bun:test'
import { ShelfNode } from '../schema'

describe('ShelfNode schema', () => {
  test('parses with all defaults applied', () => {
    const parsed = ShelfNode.parse({})
    expect(parsed.type).toBe('shelf')
    expect(parsed.id).toMatch(/^shelf_/)
    expect(parsed.width).toBe(1.2)
    expect(parsed.depth).toBe(0.3)
    expect(parsed.thickness).toBe(0.04)
    expect(parsed.height).toBe(0.9)
    expect(parsed.bracketStyle).toBe('minimal')
    expect(parsed.color).toBe('#a07050')
  })

  test('accepts user-supplied dimensions within bounds', () => {
    const parsed = ShelfNode.parse({
      width: 2.0,
      depth: 0.5,
      thickness: 0.06,
      height: 1.4,
      bracketStyle: 'industrial',
    })
    expect(parsed.width).toBe(2.0)
    expect(parsed.bracketStyle).toBe('industrial')
  })

  test('rejects width below min', () => {
    expect(() => ShelfNode.parse({ width: 0.1 })).toThrow()
  })

  test('rejects width above max', () => {
    expect(() => ShelfNode.parse({ width: 5 })).toThrow()
  })

  test('rejects unknown bracketStyle', () => {
    expect(() => ShelfNode.parse({ bracketStyle: 'mystery' })).toThrow()
  })

  test('rejects thickness above 0.1m (catches malformed AI output)', () => {
    expect(() => ShelfNode.parse({ thickness: 0.5 })).toThrow()
  })

  test('generates unique IDs across calls', () => {
    const a = ShelfNode.parse({})
    const b = ShelfNode.parse({})
    expect(a.id).not.toBe(b.id)
  })
})
