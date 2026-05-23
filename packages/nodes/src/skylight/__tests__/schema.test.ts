import { describe, expect, test } from 'bun:test'
import { SkylightNode } from '../schema'

describe('SkylightNode schema', () => {
  test('parses with the flat preset defaults', () => {
    const parsed = SkylightNode.parse({})
    expect(parsed.type).toBe('skylight')
    expect(parsed.id).toMatch(/^skylight_/)
    expect(parsed.skylightType).toBe('flat')
    expect(parsed.width).toBe(0.9)
    expect(parsed.height).toBe(1.2)
    expect(parsed.curb).toBe(true)
    expect(parsed.operationState).toBe(0)
  })

  test('accepts every type', () => {
    for (const t of ['flat', 'walk-on', 'lantern', 'opening', 'sliding'] as const) {
      expect(SkylightNode.parse({ skylightType: t }).skylightType).toBe(t)
    }
  })

  test('operationState / slideFraction clamped to [0, 1]', () => {
    expect(() => SkylightNode.parse({ operationState: -0.1 })).toThrow()
    expect(() => SkylightNode.parse({ operationState: 1.1 })).toThrow()
    expect(() => SkylightNode.parse({ slideFraction: -0.1 })).toThrow()
    expect(() => SkylightNode.parse({ slideFraction: 1.1 })).toThrow()
  })

  test('rejects unknown enums', () => {
    expect(() => SkylightNode.parse({ openingSide: 'middle' })).toThrow()
    expect(() => SkylightNode.parse({ slideDirection: 'y' })).toThrow()
  })
})
