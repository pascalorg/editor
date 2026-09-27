import { describe, expect, test } from 'bun:test'
import cabinetJson from './__fixtures__/cabinet_two_doors_drawer.json'
import downlightJson from './__fixtures__/recessed_downlight.json'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

type Shape = Recipe['parts'][number]['shapes'][number]
const one = (shape: Partial<Shape>, version: 1 | 2 = 2): Recipe => ({
  version,
  name: 'Cylinder probe',
  description: 'One cylinder.',
  parameters: [
    { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
  ],
  slots: [{ id: 'body', label: 'Body', color: '#888888' }],
  parts: [
    {
      id: 'part',
      label: 'Part',
      count: 1,
      shapes: [
        {
          id: 'c',
          primitive: 'cylinder',
          slot: 'body',
          size: [0.1, 0.2, 0.1],
          position: [0, 0.1, 0],
          ...shape,
        } as Shape,
      ],
    },
  ],
  constraints: [],
})
const triangles = (shape: Partial<Shape>) => evaluateRecipe(parseRecipe(one(shape))).triangles

describe('cylinder segments, open, inner and arc (recipe version 2)', () => {
  test('absent options mean today: a closed, solid, full 24-gon', () => {
    const [shape] = evaluateRecipe(parseRecipe(one({}, 1))).shapes
    for (const key of ['segments', 'open', 'inner', 'arc']) expect(key in shape!).toBe(false)
    expect(triangles({})).toBe(96)
    expect(evaluateRecipe(parseRecipe(structuredClone(cabinetJson))).shapes).toEqual(
      evaluateRecipe(parseRecipe({ ...structuredClone(cabinetJson), version: 2 })).shapes,
    )
  })

  test('segments give exact hexagonal and octagonal prisms', () => {
    expect(triangles({ segments: 6 })).toBe(24)
    expect(triangles({ segments: 8 })).toBe(32)
    expect(triangles({ segments: 4, topScale: 0 })).toBe(8)
    expect(evaluateRecipe(parseRecipe(one({ segments: 6 }))).shapes[0]!.segments).toBe(6)
  })

  test('open drops the caps and draws both wall faces; inner makes a tube; arc closes its wedge sides', () => {
    expect(triangles({ open: true })).toBe(96)
    expect(triangles({ inner: 0.8 })).toBe(24 * 8)
    expect(triangles({ inner: 0.8, open: true })).toBe(24 * 4)
    expect(triangles({ inner: 0.8, topScale: 0.5 })).toBe(24 * 8)
    expect(triangles({ arc: Math.PI })).toBe(96 + 4)
    expect(triangles({ arc: Math.PI, open: true })).toBe(96)
    expect(triangles({ arc: Math.PI, inner: 0.9, segments: 12 })).toBe(12 * 8 + 4)
    const [tube] = evaluateRecipe(parseRecipe(one({ inner: 0.8, arc: Math.PI / 2 }))).shapes
    expect([tube!.inner, tube!.arc]).toEqual([0.8, Math.PI / 2])
  })

  test('options are validated, v2-only and cylinder-only', () => {
    for (const bad of [
      { segments: 2 },
      { segments: 65 },
      { segments: 6.5 },
      { inner: 0 },
      { inner: 1 },
      { arc: 0 },
      { arc: 7 },
      { inner: 0.5, support: true },
      { arc: 1, support: true },
    ])
      expect(() => parseRecipe(one(bad as Partial<Shape>))).toThrow()
    expect(() => parseRecipe(one({ segments: 6 }, 1))).toThrow('version 2')
    expect(() => parseRecipe(one({ open: true }, 1))).toThrow('version 2')
    expect(() => parseRecipe(one({ primitive: 'box', segments: 6 }))).toThrow('cylinder')
  })

  test('a recessed hexagonal can fits a cut its round 24-gon would not', () => {
    const recipe = structuredClone(downlightJson) as Recipe
    recipe.cuts = [{ shape: 'rect', size: [0.1, 0.1] }]
    recipe.parts = recipe.parts.filter((part) => part.id !== 'lens')
    recipe.parts.find((part) => part.id === 'can')!.shapes = [
      {
        id: 'can',
        primitive: 'cylinder',
        slot: 'can',
        segments: 4,
        rotation: [0, Math.PI / 4, 0],
        size: [0.14, 0.1, 0.14],
        position: [0, 0.06, 0],
      },
    ]
    expect(() => parseRecipe(recipe)).not.toThrow()
    delete recipe.parts.find((part) => part.id === 'can')!.shapes[0]!.segments
    expect(() => parseRecipe(recipe)).toThrow('outside its cut')
  })
})
