import { describe, expect, test } from 'bun:test'
import { ShelfNode } from '../schema'

describe('ShelfNode schema', () => {
  test('parses with v2 defaults applied (v1 wall-shelf visual preserved)', () => {
    const parsed = ShelfNode.parse({})
    expect(parsed.type).toBe('shelf')
    expect(parsed.id).toMatch(/^shelf_/)
    expect(parsed.width).toBe(1.2)
    expect(parsed.depth).toBe(0.3)
    expect(parsed.thickness).toBe(0.04)
    expect(parsed.height).toBe(0.9)
    expect(parsed.style).toBe('wall-shelf')
    expect(parsed.rows).toBe(1)
    expect(parsed.columns).toBe(1)
    expect(parsed.withBack).toBe(false)
    expect(parsed.withSides).toBe(true)
    expect(parsed.withBottom).toBe(false)
    expect(parsed.bracketStyle).toBe('minimal')
    // material / materialPreset default to undefined — the geometry
    // builder uses `DEFAULT_SHELF_MATERIAL` when both are unset.
    expect(parsed.material).toBeUndefined()
    expect(parsed.materialPreset).toBeUndefined()
  })

  test('v1-shaped input parses cleanly (forward compatibility)', () => {
    // v1 scenes carried { width, depth, thickness, height, bracketStyle,
    // color }. v2 dropped `color` in favour of `material` + `materialPreset`;
    // unknown keys on a Zod object pass through and are stripped by
    // `.parse`. New v2 fields fall back to defaults that reproduce v1
    // visuals (style=wall-shelf, rows=1) so saved scenes load unchanged.
    const parsed = ShelfNode.parse({
      width: 1.5,
      depth: 0.35,
      thickness: 0.05,
      height: 1.2,
      bracketStyle: 'industrial',
      color: '#553322',
    })
    expect(parsed.style).toBe('wall-shelf')
    expect(parsed.rows).toBe(1)
    expect(parsed.bracketStyle).toBe('industrial')
    expect((parsed as { color?: string }).color).toBeUndefined()
  })

  test('accepts user-supplied dimensions within bounds', () => {
    const parsed = ShelfNode.parse({
      width: 2.0,
      depth: 0.5,
      thickness: 0.06,
      height: 1.4,
      bracketStyle: 'industrial',
      style: 'bookshelf',
      rows: 4,
      columns: 2,
    })
    expect(parsed.width).toBe(2.0)
    expect(parsed.style).toBe('bookshelf')
    expect(parsed.rows).toBe(4)
    expect(parsed.columns).toBe(2)
  })

  test('rejects unknown style', () => {
    expect(() => ShelfNode.parse({ style: 'mystery' })).toThrow()
  })

  test('rejects rows above 8 and below 1', () => {
    expect(() => ShelfNode.parse({ rows: 0 })).toThrow()
    expect(() => ShelfNode.parse({ rows: 9 })).toThrow()
    expect(() => ShelfNode.parse({ rows: 1.5 })).toThrow()
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
