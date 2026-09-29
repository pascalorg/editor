import { describe, expect, test } from 'bun:test'
import downlightJson from './__fixtures__/recessed_downlight.json'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

const design = (shape: Record<string, unknown>, version: 1 | 2 = 2): Recipe =>
  ({
    version,
    name: 'Revolve probe',
    description: 'One turned shape.',
    parameters: [
      { id: 'flare', label: 'Flare', default: 0.12, min: 0.06, max: 0.2, step: 0.01, unit: 'm' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'part',
        label: 'Part',
        count: 1,
        shapes: [{ id: 'r', primitive: 'revolve', slot: 'body', position: [0, 0, 0], ...shape }],
      },
    ],
    constraints: [],
  }) as Recipe
// Trial E7's measured bell shade: (height, radius) from the rim up, as the block candidate lathed it.
const bell: [number, number][] = [
  [0.0, 0.082],
  [0.014, 0.102],
  [0.05, 0.115],
  [0.091, 0.119],
  [0.149, 0.114],
  [0.192, 0.092],
  [0.224, 0.058],
  [0.235, 0.025],
]
const shade = bell.map(([h, r]) => [r, h])
// A turned baluster closed to the axis at both ends: a solid of revolution.
const baluster = [
  [0, 0],
  [0.02, 0],
  [0.02, 0.08],
  [0.012, 0.12],
  [0.016, 0.4],
  [0.02, 0.7],
  [0.012, 0.75],
  [0.02, 0.8],
  [0.02, 0.86],
  [0, 0.86],
]

describe('revolve (recipe version 2)', () => {
  test('a closed profile turns into a one-sided solid in a centred box', () => {
    const e = evaluateRecipe(parseRecipe(design({ profile: baluster, segments: 16 })))
    const [shape] = e.shapes
    expect(shape!.size[0]).toBeCloseTo(0.04)
    expect(shape!.size[1]).toBeCloseTo(0.86)
    expect(shape!.position[1]).toBeCloseTo(0.43)
    expect(Math.min(...shape!.profile!.map(([, y]) => y))).toBeCloseTo(-0.43)
    expect(e.triangles).toBe(2 * 16 * (baluster.length - 1))
    expect(e.min[1]).toBeCloseTo(0)
  })

  test('an open profile such as the E7 shade draws both faces', () => {
    const e = evaluateRecipe(parseRecipe(design({ profile: shade })))
    expect(e.triangles).toBe(2 * 2 * 24 * (shade.length - 1))
    expect(e.shapes[0]!.size[0]).toBeCloseTo(0.238)
    const partial = evaluateRecipe(parseRecipe(design({ profile: baluster, arc: Math.PI })))
    expect(partial.triangles).toBe(2 * 2 * 24 * (baluster.length - 1))
  })

  test('profile points may be expressions', () => {
    const flared = [
      [0.02, 0],
      ['flare', 0.3],
    ]
    const a = evaluateRecipe(parseRecipe(design({ profile: flared })))
    const b = evaluateRecipe(parseRecipe(design({ profile: flared })), { flare: 0.2 })
    expect(a.shapes[0]!.size[0]).toBeCloseTo(0.24)
    expect(b.shapes[0]!.size[0]).toBeCloseTo(0.4)
  })

  test('a point that collapses onto the previous one is dropped', () => {
    const footed = [
      [0, 0],
      [0.03, 0],
      [0.03, { op: 'mul', args: ['flare', 0] }],
      [0.02, 0.2],
      [0, 0.2],
    ]
    const e = evaluateRecipe(parseRecipe(design({ profile: footed })))
    expect(e.shapes[0]!.profile).toHaveLength(4)
    expect(e.triangles).toBe(2 * 24 * 3)
  })

  test('revolve is validated and v2-only', () => {
    expect(() => parseRecipe(design({ profile: baluster }, 1))).toThrow('version 2')
    for (const bad of [
      {},
      { profile: [[0.1, 0]] },
      {
        profile: [
          [-0.1, 0],
          [0.1, 1],
        ],
      },
      {
        profile: [
          [0, 0],
          [0, 1],
        ],
      },
      {
        profile: [
          [0.1, 0],
          [0.1, 0],
        ],
      },
      { profile: baluster, size: [1, 1, 1] },
      { profile: baluster, support: true },
      { profile: baluster, inner: 0.5 },
      { profile: baluster, segments: 2 },
    ])
      expect(() => parseRecipe(design(bad))).toThrow()
    expect(() =>
      parseRecipe(design({ primitive: 'box', size: [1, 1, 1], profile: baluster })),
    ).toThrow('profile')
  })
})

describe('revolve review fixes (AK-03c round 2)', () => {
  test('a revolve fits a circle cut of its own diameter', () => {
    const recipe = structuredClone(downlightJson) as Recipe
    recipe.cuts = [{ shape: 'circle', diameter: 0.12 }]
    recipe.parts = recipe.parts.filter((part) => part.id !== 'lens')
    recipe.parts.find((part) => part.id === 'can')!.shapes = [
      {
        id: 'can',
        primitive: 'revolve',
        slot: 'can',
        profile: [
          [0, 0.01],
          [0.06, 0.01],
          [0.06, 0.1],
          [0, 0.1],
        ],
        position: [0, 0, 0],
      },
    ]
    expect(() => parseRecipe(recipe)).not.toThrow()
  })
  test('a stray radius on a revolve is refused', () => {
    expect(() => parseRecipe(design({ profile: baluster, radius: 0.02 }))).toThrow('radius')
  })
})
