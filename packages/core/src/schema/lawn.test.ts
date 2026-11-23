import { describe, expect, test } from 'bun:test'
import { AnyNode, LAWN_LIMITS, LawnNode, LawnStroke, SlabNode } from './index'

const outline = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]
const stroke = { points: [[1, 1]], radiusM: 0.5, effect: 'bare', strength: 0.75 }

describe('saved core lawn', () => {
  test('round-trips parameters and strokes without derived geometry or a plugin', () => {
    const lawn = LawnNode.parse({ parentId: 'site_a', outline, strokes: [stroke] })
    expect(lawn).toMatchObject({
      type: 'lawn',
      height: 0.06,
      bladeWidth: 0.008,
      density: 100,
      roughness: 0.2,
      color: '#617c36',
      edgeFade: 0.1,
      wind: 0.2,
      seed: 1,
      gen: 1,
      flowerDensity: 0,
      flowers: [],
      season: 'summer',
      strokes: [stroke],
    })
    expect(AnyNode.parse(JSON.parse(JSON.stringify(lawn)))).toEqual(lawn)
    expect(Object.keys(lawn)).not.toContain('geometry')
  })

  test.each([
    { gen: 2 },
    { seed: 2147483648 },
    { height: 0.009 },
    { bladeWidth: 0.031 },
    { density: 101 },
    { flowerDensity: 2.01 },
    { flowers: [{ species: 'rose', share: 1 }] },
    {
      outline: [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
      ],
    },
    {
      outline: [
        [0, 0],
        [0.1, 0],
        [0.1, 0.1],
        [0, 0.1],
      ],
    },
    {
      outline: [
        [0, 0],
        [51, 0],
        [51, 50],
        [0, 50],
      ],
    },
  ])('refuses an unsupported or unbounded saved lawn: %j', (fields) => {
    expect(LawnNode.safeParse({ outline, ...fields }).success).toBe(false)
  })

  test.each([
    { points: [] },
    { points: [[Infinity, 0]] },
    { points: [[100001, 0]] },
    { radiusM: 0.049 },
    { radiusM: 1000.01 },
    { strength: 1.01 },
    { effect: 'paint' },
  ])('refuses unsafe brush data: %j', (fields) => {
    expect(LawnStroke.safeParse({ ...stroke, ...fields }).success).toBe(false)
  })

  test('budgets 20,000 points across all strokes, not the number of strokes', () => {
    const dabs = Array.from({ length: LAWN_LIMITS.maxStrokePoints }, () => stroke)
    expect(LawnNode.safeParse({ outline, strokes: dabs }).success).toBe(true)
    const over = LawnNode.safeParse({ outline, strokes: [...dabs, stroke] })
    expect(over.success).toBe(false)
    if (!over.success) expect(over.error.message).toMatch(/20,000.*points/)

    const points = Array.from({ length: LAWN_LIMITS.maxStrokePoints }, () => [1, 1])
    const longStroke = { ...stroke, points }
    const saved = LawnNode.parse({ outline, strokes: [longStroke] })
    expect(saved.strokes).toEqual([longStroke])
    expect(AnyNode.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    expect(LawnNode.safeParse({ outline, strokes: [longStroke, stroke] }).success).toBe(false)
    expect(LawnStroke.safeParse({ ...longStroke, points: [...points, [2, 1]] }).success).toBe(false)
  })

  test('accepts all six effects and the three explicit flower species', () => {
    for (const effect of ['bare', 'grass', 'taller', 'shorter', 'more-flowers', 'fewer-flowers'])
      expect(LawnStroke.safeParse({ ...stroke, effect }).success).toBe(true)
    expect(
      LawnNode.parse({
        outline,
        flowers: ['daisy', 'clover', 'yarrow'].map((species) => ({ species, share: 1 })),
      }).flowers,
    ).toHaveLength(3)
  })

  test('keeps an existing flat lawn slab unchanged', () => {
    const slab = SlabNode.parse({
      polygon: outline,
      elevation: 0.01,
      materialPreset: 'library:preset-lawn',
      metadata: { flatwork: 'lawn' },
    })
    expect(AnyNode.parse(slab)).toEqual(slab)
  })
})
