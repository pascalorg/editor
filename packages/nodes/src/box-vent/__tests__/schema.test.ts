import { describe, expect, test } from 'bun:test'
import { BoxVentNode, boxVentDefinition } from '../index'

describe('BoxVentNode schema', () => {
  test('parses with sensible defaults', () => {
    const parsed = BoxVentNode.parse({})
    expect(parsed.type).toBe('box-vent')
    expect(parsed.id).toMatch(/^bvent_/)
    expect(parsed.width).toBe(0.4)
    expect(parsed.depth).toBe(0.4)
    expect(parsed.height).toBe(0.15)
    expect(parsed.hoodOverhang).toBe(0.04)
    expect(parsed.style).toBe('cap')
    expect(parsed.position).toEqual([0, 0, 0])
    expect(parsed.rotation).toBe(0)
    expect(parsed.material).toBeUndefined()
    expect(parsed.materialPreset).toBe('preset-white')
    expect(parsed.roofSegmentId).toBeUndefined()
  })

  test('accepts each style', () => {
    expect(BoxVentNode.parse({ style: 'box' }).style).toBe('box')
    expect(BoxVentNode.parse({ style: 'cap' }).style).toBe('cap')
    expect(BoxVentNode.parse({ style: 'dome' }).style).toBe('dome')
  })

  test('rejects unknown style', () => {
    expect(() => BoxVentNode.parse({ style: 'unknown' })).toThrow()
  })

  test('round-trips dimensions and segment binding', () => {
    const parsed = BoxVentNode.parse({
      width: 0.6,
      depth: 0.5,
      height: 0.2,
      hoodOverhang: 0.08,
      style: 'dome',
      roofSegmentId: 'rseg_abc',
      position: [1.2, 0, -0.5],
      rotation: Math.PI / 4,
    })
    expect(parsed.width).toBe(0.6)
    expect(parsed.depth).toBe(0.5)
    expect(parsed.height).toBe(0.2)
    expect(parsed.hoodOverhang).toBe(0.08)
    expect(parsed.style).toBe('dome')
    expect(parsed.roofSegmentId).toBe('rseg_abc')
    expect(parsed.position).toEqual([1.2, 0, -0.5])
    expect(parsed.rotation).toBeCloseTo(Math.PI / 4)
  })

  test('generates unique IDs across calls', () => {
    const a = BoxVentNode.parse({})
    const b = BoxVentNode.parse({})
    expect(a.id).not.toBe(b.id)
  })
})

test('advertised box vent styles are current schema values, while old scenes still migrate', () => {
  const style = boxVentDefinition
    .parametrics!.groups!.flatMap((group) => group.fields)
    .find((field) => field.key === 'style')!
  expect(style.kind).toBe('enum')
  if (style.kind !== 'enum') throw new Error('Missing style choices')
  expect(style.options).toEqual(['box', 'cap', 'dome'])
  for (const value of style.options) expect(BoxVentNode.parse({ style: value }).style).toBe(value)
  expect(BoxVentNode.parse({ style: 'standard' }).style).toBe('cap')
  expect(BoxVentNode.parse({ style: 'low-profile' }).style).toBe('box')
})

test('old scenes retain their footprint while newly placed vents get flashing and an opening', () => {
  const old = BoxVentNode.parse({ width: 0.4, height: 0.15 })
  expect(old.flashingWidth).toBeUndefined()
  expect(old.capGap).toBe(0)
  const fresh = BoxVentNode.parse(boxVentDefinition.defaults())
  expect(fresh.flashingWidth).toBe(0.05)
  expect(fresh.capGap).toBe(0.02)
  expect(BoxVentNode.safeParse({ flashingWidth: -1 }).success).toBe(false)
})

test('reducing the housing dimensions keeps editable details inside it', () => {
  const old = BoxVentNode.parse({ style: 'cap', capHeight: 0.1, capGap: 0.04 })
  const patch = { height: 0.05, width: 0.1, depth: 0.1 }
  const next = { ...old, ...patch }
  const derived = boxVentDefinition.parametrics!.derive!(next, patch, old)
  expect(derived.capHeight! + derived.capGap!).toBeLessThanOrEqual(patch.height - 0.01 + 1e-8)
  expect(derived.baseInset! * 2).toBeLessThan(patch.width)
  expect(derived.baseHeight!).toBeLessThan(patch.height)
})
