import { describe, expect, test } from 'bun:test'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

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
    expect(() => parseRecipe(many(1, 170, 'roundedBox'))).not.toThrow()
    expect(() => parseRecipe(many(1, 171, 'roundedBox'))).toThrow('Triangle budget exceeded')
    expect(evaluateRecipe(many(1, 170, 'roundedBox')).triangles).toBe(170 * 300)
  })

  test('v2 is gated by real counts, so more rounded boxes and cones fit', () => {
    expect(() => parseRecipe(many(2, 171, 'roundedBox', 64))).not.toThrow()
    expect(() => parseRecipe(many(2, 334, 'roundedBox', 64))).toThrow('Triangle budget exceeded')
    expect(() => parseRecipe(many(2, 138, 'ellipsoid', 64))).not.toThrow()
    expect(() => parseRecipe(many(2, 139, 'ellipsoid', 64))).toThrow('Triangle budget exceeded')
  })

  test('v2 lifts the 16 x 24 part caps and the 256 expanded-shape cap', () => {
    // The trial's E3 kitchen run: 26 parts, one of them holding 185 backsplash tiles.
    const tiles = Array.from({ length: 185 }, (_, i) => box(`tile_${i}`, i * 0.02))
    const cabinets = Array.from({ length: 25 }, (_, p) =>
      Array.from({ length: 5 }, (_, i) => box(`s${i}`, p * 0.2 + i * 0.02)),
    )
    const kitchen = [...cabinets, tiles]
    expect(evaluateRecipe(parseRecipe(design(2, kitchen))).shapes).toHaveLength(310)
    expect(() => parseRecipe(design(1, kitchen))).toThrow('version 2')
    expect(() => parseRecipe(design(1, [tiles.slice(0, 25)]))).toThrow('version 2')
    expect(() => parseRecipe(many(1, 257, 'box'))).toThrow()
  })

  test('v2 still refuses more than 64 parts, 512 shapes per part or 512 expanded shapes', () => {
    expect(() => parseRecipe(many(2, 65, 'box', 1))).toThrow()
    expect(() => parseRecipe(many(2, 513, 'box', 513))).toThrow()
    expect(() => parseRecipe(many(2, 512, 'box', 512))).not.toThrow()
    const repeated = many(2, 64, 'box', 64)
    repeated.parts[0]!.count = 9
    expect(() => parseRecipe(repeated)).toThrow('Expanded shape budget exceeded')
  })
})
