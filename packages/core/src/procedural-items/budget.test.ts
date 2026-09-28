import { describe, expect, test } from 'bun:test'
import e3Json from './__fixtures__/trial_e3_kitchen_direct.json'
import { evaluateRecipe, parseRecipe, type Recipe, RecipeSchema } from './recipe'

type Shape = Recipe['parts'][number]['shapes'][number]
const box = (id: string, x: number, primitive: Shape['primitive'] = 'box'): Shape => ({
  id,
  primitive,
  slot: 'body',
  size: [0.01, 0.01, 0.01],
  position: [x, 0.005, 0],
  ...(primitive === 'roundedBox' ? { radius: 0.002 } : {}),
})
const design = (version: 1 | 2, parts: Shape[][]): Recipe => ({
  version,
  name: 'Budget probe',
  description: 'Many small shapes.',
  parameters: [
    { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
  ],
  slots: [{ id: 'body', label: 'Body', color: '#888888' }],
  parts: parts.map((shapes, i) => ({ id: `part_${i}`, label: `Part ${i}`, count: 1, shapes })),
  constraints: [],
})
// n shapes of one primitive, packed into parts of at most `perPart` shapes.
const many = (version: 1 | 2, n: number, primitive: Shape['primitive'], perPart = 24) =>
  design(
    version,
    Array.from({ length: Math.ceil(n / perPart) }, (_, p) =>
      Array.from({ length: Math.min(perPart, n - p * perPart) }, (_, i) =>
        box(`s${i}`, (p * perPart + i) * 0.02, primitive),
      ),
    ),
  )
// n shapes as repeated parts (count up to 64), compact enough for any byte cap.
const counted = (version: 1 | 2, n: number, primitive: Shape['primitive']): Recipe => {
  const recipe = design(
    version,
    Array.from({ length: Math.ceil(n / 64) }, () => [box('s', 0, primitive)]),
  )
  recipe.parts.forEach((part, p) => {
    part.count = Math.min(64, n - p * 64)
    part.shapes[0]!.position = [{ op: 'mul', args: ['index', 0.02] }, 0.005, p * 0.1]
  })
  return recipe
}

describe('triangle budgets from evaluated counts', () => {
  test('each primitive reports the triangles its three.js generator builds', () => {
    const single = (shape: Partial<Shape>) =>
      evaluateRecipe(design(2, [[{ ...box('s', 0), ...shape }]])).triangles
    expect(single({ primitive: 'box' })).toBe(12)
    expect(single({ primitive: 'roundedBox', radius: 0.002 })).toBe(300)
    expect(single({ primitive: 'cylinder' })).toBe(96)
    expect(single({ primitive: 'cylinder', topScale: 0 })).toBe(48)
    expect(single({ primitive: 'ellipsoid' })).toBe(720)
  })

  test('v1 acceptance is unchanged: the legacy charges still gate v1', () => {
    expect(() => parseRecipe(counted(1, 170, 'roundedBox'))).not.toThrow()
    expect(() => parseRecipe(counted(1, 171, 'roundedBox'))).toThrow('Triangle budget exceeded')
    expect(evaluateRecipe(counted(1, 170, 'roundedBox')).triangles).toBe(170 * 300)
  })

  test('v2 is gated by real counts, so more rounded boxes and cones fit', () => {
    expect(() => parseRecipe(counted(2, 171, 'roundedBox'))).not.toThrow()
    expect(() => parseRecipe(counted(2, 334, 'roundedBox'))).toThrow('Triangle budget exceeded')
    expect(() => parseRecipe(counted(2, 138, 'ellipsoid'))).not.toThrow()
    expect(() => parseRecipe(counted(2, 139, 'ellipsoid'))).toThrow('Triangle budget exceeded')
  })

  test('v2 lifts the 16 x 24 part caps and the 256 expanded-shape cap', () => {
    const parts = Array.from({ length: 20 }, (_, p) => [box('s', p * 0.2)])
    const long = Array.from({ length: 30 }, (_, i) => box(`s${i}`, 5 + i * 0.02))
    expect(evaluateRecipe(parseRecipe(design(2, [...parts, long]))).shapes).toHaveLength(50)
    expect(() => parseRecipe(design(1, parts))).toThrow('version 2')
    expect(() => parseRecipe(design(1, [long]))).toThrow('version 2')
    expect(() => parseRecipe(many(1, 257, 'box'))).toThrow()
    const counted = design(2, [[box('s', 0)]])
    counted.parts[0]!.count = 64
    counted.parts.push(
      ...structuredClone(counted.parts).map((part, i) => ({ ...part, id: `p${i}` })),
    )
    expect(evaluateRecipe(parseRecipe(counted)).shapes).toHaveLength(128)
  })

  test('v2 still refuses more than 64 parts, 512 shapes per part or 512 expanded shapes', () => {
    expect(() => parseRecipe(many(2, 65, 'box', 1))).toThrow()
    expect(() => parseRecipe(many(2, 513, 'box', 513))).toThrow()
    const repeated = design(
      2,
      Array.from({ length: 9 }, (_, p) => [box('s', p)]),
    )
    for (const part of repeated.parts) part.count = 64
    expect(() => parseRecipe(repeated)).toThrow('Expanded shape budget exceeded')
  })
})

describe('budget review fixes (AK-10a round 2)', () => {
  test('R7: a v2 recipe above 24 KiB needs pinned definitions (the real E3 run, 37.9 KB)', () => {
    const e3 = structuredClone(e3Json) as Recipe
    expect(e3.parts.reduce((n, part) => n + part.shapes.length, 0)).toBe(323)
    expect(JSON.stringify(e3).length).toBeGreaterThan(24 * 1024)
    expect(() => parseRecipe(e3)).toThrow('24 KiB')
    expect(RecipeSchema.safeParse(e3).success).toBe(false)
  })

  test('support shapes count toward the 256-surface budget', () => {
    const supports = design(2, [
      Array.from({ length: 5 }, (_, i) => ({ ...box(`s${i}`, i * 0.02), support: true })),
    ])
    supports.parts[0]!.count = 64
    supports.parts[0]!.shapes = supports.parts[0]!.shapes.map((shape) => ({
      ...shape,
      position: [
        { op: 'add', args: [shape.position[0], { op: 'mul', args: ['index', 0.1] }] },
        0.005,
        0,
      ],
    }))
    expect(() => parseRecipe(supports)).toThrow('Surface budget exceeded')
  })

  test('the exported schema keeps v1 at 16 parts x 24 shapes', () => {
    expect(RecipeSchema.safeParse(many(1, 25, 'box', 25)).success).toBe(false)
    expect(RecipeSchema.safeParse(many(1, 24, 'box', 24)).success).toBe(true)
  })
})
