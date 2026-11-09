import { describe, expect, test } from 'bun:test'
import { CeilingNode } from '../schema/nodes/ceiling'
import { LevelNode } from '../schema/nodes/level'
import cabinetJson from './__fixtures__/cabinet_two_doors_drawer.json'
import chandelierJson from './__fixtures__/chandelier_six_arms.json'
import deskFanJson from './__fixtures__/desk_fan.json'
import e7Json from './__fixtures__/trial_e7_pendant_fixed_top.json'
import e8Json from './__fixtures__/trial_e8_stair_guard.json'
import { radiatorRecipe, shelfRecipe } from './fixtures'
import { ProceduralItemNode } from './node'
import { validateProceduralRelations } from './query'
import {
  type Expr,
  evaluateRecipe,
  parseRecipe,
  type Recipe,
  RecipeSchema,
  sweepRecipe,
} from './recipe'

// Trial E7 (/next elec-p13-symbol-22244): a five-drop pendant whose canopy top is fixed at the
// ceiling. Longer drops hang below design y = 0, which the ceiling relation check already bounds.
const TOP = 1.025
const x: Expr = { op: 'add', args: [-0.48, { op: 'mul', args: ['index', 0.24] }] }
const drop: Expr = {
  op: 'add',
  args: [1, 2, 3, 4, 5].map((k) => ({
    op: 'mul' as const,
    args: [
      `drop_${k}`,
      {
        op: 'max' as const,
        args: [
          0,
          {
            op: 'sub' as const,
            args: [
              1,
              { op: 'abs' as const, args: [{ op: 'sub' as const, args: ['index', k - 1] }] },
            ],
          },
        ],
      },
    ] as Expr[],
  })),
}
const shadeY = (dy: number): Expr => ({ op: 'add', args: [{ op: 'sub', args: [TOP, drop] }, dy] })
const pendant = (version: 1 | 2) =>
  ({
    version,
    name: 'Five-drop pendant',
    description: 'Linear canopy with five staggered cord drops and bell shades.',
    mounting: { attachTo: 'ceiling', reference: 'canopy_top' },
    surfaces: [{ id: 'canopy_top', label: 'Canopy top', position: [0, TOP, 0], size: [1.2, 0.18] }],
    parameters: [0.79, 0.59, 0.75, 0.48, 0.64].map((value, k) => ({
      id: `drop_${k + 1}`,
      label: `Drop ${k + 1}`,
      default: value,
      min: 0.3,
      max: 0.9,
      step: 0.01,
      unit: 'm' as const,
    })),
    slots: [
      { id: 'dark', label: 'Canopy and cords', color: '#1d1e20' },
      { id: 'smoke', label: 'Smoked glass', color: '#5a4e44' },
    ],
    parts: [
      {
        id: 'canopy',
        label: 'Canopy',
        count: 1,
        shapes: [
          {
            id: 'plate',
            primitive: 'box' as const,
            slot: 'dark',
            size: [1.2, 0.026, 0.18],
            position: [0, TOP - 0.013, 0],
          },
        ],
      },
      {
        id: 'drop',
        label: 'Drop',
        count: 5,
        shapes: [
          {
            id: 'cord',
            primitive: 'cylinder' as const,
            slot: 'dark',
            size: [0.006, drop, 0.006],
            position: [x, { op: 'sub', args: [TOP, { op: 'div', args: [drop, 2] }] }, 0],
          },
          {
            id: 'shade',
            primitive: 'ellipsoid' as const,
            slot: 'smoke',
            size: [0.24, 0.235, 0.24],
            position: [x, shadeY(-0.1175), 0],
          },
        ],
      },
    ],
    constraints: [],
  }) as Recipe

// Trial E8 (/next main-stair lower flight): baluster bottoms step with the riser parameter, so a
// shorter riser puts the first baluster below the newel base at design y = 0.
const bottom: Expr = {
  op: 'mul',
  args: [
    'riser',
    {
      op: 'add',
      args: [
        1,
        { op: 'floor', args: [{ op: 'div', args: [{ op: 'add', args: ['index', 1] }, 3] }] },
      ],
    },
  ],
}
const top: Expr = { op: 'add', args: [1.1765, { op: 'mul', args: ['index', 0.0896, 0.762] }] }
const guard = (version: 1 | 2, base?: Expr) =>
  ({
    version,
    name: 'Stair guard',
    description: 'Newel and balusters stepping with the treads.',
    ...(base === undefined ? {} : { base }),
    parameters: [
      {
        id: 'riser',
        label: 'Riser',
        default: 0.1935,
        min: 0.15,
        max: 0.21,
        step: 0.0005,
        unit: 'm',
      },
      { id: 'balusters', label: 'Balusters', default: 7, min: 1, max: 12, step: 1, unit: 'count' },
    ],
    slots: [{ id: 'paint', label: 'Paint', color: '#f2efe8' }],
    parts: [
      {
        id: 'newel',
        label: 'Newel',
        count: 1,
        shapes: [
          {
            id: 'post',
            primitive: 'box',
            slot: 'paint',
            size: [0.14, 0.939, 0.14],
            position: [0, 0.4695, 0],
          },
        ],
      },
      {
        id: 'baluster',
        label: 'Baluster',
        count: 'balusters',
        shapes: [
          {
            id: 'post',
            primitive: 'box',
            slot: 'paint',
            size: [0.036, { op: 'sub', args: [top, bottom] }, 0.036],
            position: [
              { op: 'add', args: [0.159, { op: 'mul', args: ['index', 0.0896] }] },
              {
                op: 'sub',
                args: [{ op: 'div', args: [{ op: 'add', args: [top, bottom] }, 2] }, 0.194],
              },
              0,
            ],
          },
        ],
      },
    ],
    constraints: [],
  }) as Recipe
const lowestBaluster: Expr = { op: 'min', args: [0, { op: 'sub', args: ['riser', 0.194] }] }

describe('design-level datum (recipe version 2)', () => {
  test('v1 keeps the y = 0 rule: the E7 and E8 sweeps still fail there', () => {
    const invalid = (recipe: Recipe) => sweepRecipe(recipe).filter((entry) => !entry.valid)
    expect(invalid(pendant(1)).length).toBeGreaterThan(0)
    expect(invalid(pendant(1))[0]!.error).toContain('below the ground')
    expect(invalid(guard(1)).length).toBeGreaterThan(0)
    expect(invalid(guard(1))[0]!.error).toContain('below the ground')
  })

  test('a v2 ceiling design hangs from its top reference, so the E7 sweep is fully valid', () => {
    const recipe = parseRecipe(pendant(2))
    expect(sweepRecipe(recipe).filter((entry) => !entry.valid)).toEqual([])
    const longest = evaluateRecipe(recipe, { drop_1: 0.9 })
    expect(longest.min[1]).toBeLessThan(0)
    expect(longest.max[1]).toBeCloseTo(TOP)
  })

  test('a v2 ceiling design is still bounded by the level floor through its host', () => {
    const level = LevelNode.parse({ id: 'level_datum', height: 3 })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_datum',
      parentId: level.id,
      height: 2.6,
      polygon: [
        [-4, -4],
        [4, -4],
        [4, 4],
        [-4, 4],
      ],
    })
    const node = ProceduralItemNode.parse({
      id: 'procedural-item_datum',
      recipe: pendant(2),
      parentId: ceiling.id,
      parameters: { drop_1: 0.9 },
    })
    const nodes = { [level.id]: level, [ceiling.id]: ceiling, [node.id]: node }
    expect(() => validateProceduralRelations(node, nodes)).not.toThrow()
    const low = { ...nodes, [ceiling.id]: { ...ceiling, height: 1 } }
    expect(() => validateProceduralRelations(node, low)).toThrow('level height')
  })

  test('a declared base lets the E8 guard rest on its lowest point across the sweep', () => {
    const recipe = parseRecipe(guard(2, lowestBaluster))
    expect(sweepRecipe(recipe).filter((entry) => !entry.valid)).toEqual([])
    for (const riser of [0.15, 0.1935, 0.21]) {
      const evaluation = evaluateRecipe(recipe, { riser })
      expect(evaluation.min[1]).toBeCloseTo(0)
      const newel = evaluation.shapes.find((shape) => shape.partId === 'newel')!
      expect(newel.position[1] - newel.size[1] / 2).toBeCloseTo(-Math.min(0, riser - 0.194))
    }
    expect(sweepRecipe(guard(2)).some((entry) => !entry.valid)).toBe(true)
  })

  test('the base moves every evaluated output together', () => {
    const up = (e: Expr): Expr => ({ op: 'add', args: [e, 0.25] })
    const chandelier = structuredClone(chandelierJson) as Recipe
    delete chandelier.mounting
    for (const source of [shelfRecipe, cabinetJson, deskFanJson, chandelier] as Recipe[]) {
      const raised = structuredClone(source)
      raised.version = 2
      raised.base = 0.25
      for (const part of raised.parts) {
        for (const shape of part.shapes) shape.position[1] = up(shape.position[1])
        if (part.motion && part.motion.kind !== 'slide')
          part.motion.pivot[1] = up(part.motion.pivot[1])
        if (part.light) part.light.position[1] = up(part.light.position[1])
      }
      for (const surface of raised.surfaces ?? []) surface.position[1] = up(surface.position[1])
      const a = evaluateRecipe(parseRecipe(raised))
      const b = evaluateRecipe(parseRecipe(source))
      const points = (e: typeof a) => [
        e.min,
        e.max,
        ...e.shapes.map((s) => s.position),
        ...e.surfaces.map((s) => s.position),
        ...e.lights.map((l) => l.position),
        ...e.motions.map((m) => m.pivot),
      ]
      const expected = points(b).flat()
      expect(points(a).flat().length).toBe(expected.length)
      for (const [i, value] of points(a).flat().entries())
        expect(value).toBeCloseTo(expected[i]!, 9)
      expect(a.motions.map((m) => m.id)).toEqual(b.motions.map((m) => m.id))
      raised.base = 0.26 + b.min[1]
      expect(() => parseRecipe(raised)).toThrow('below the declared base')
    }
  })

  test('the base is v2-only, floor-only and version 3 is refused', () => {
    expect(() => parseRecipe(guard(1, lowestBaluster))).toThrow('version 2')
    expect(() => parseRecipe({ ...pendant(2), base: 0 })).toThrow('floor designs')
    expect(() => parseRecipe({ ...shelfRecipe, version: 3 })).toThrow()
    expect(parseRecipe({ ...shelfRecipe, version: 2 }).version).toBe(2)
  })
})

describe('datum review fixes (AK-D1 round 2)', () => {
  const lowest = { op: 'min', args: [0, { op: 'sub', args: ['riser', 0.194] }] } as Expr
  test('the trial fixtures: E7 15/33 → 33/33 and E8 14/29 → 29/29', () => {
    const valid = (recipe: Recipe) => sweepRecipe(recipe).filter((entry) => entry.valid).length
    const e7 = structuredClone(e7Json) as Recipe
    const e8 = structuredClone(e8Json) as Recipe
    expect([valid(e7), sweepRecipe(e7).length]).toEqual([15, 33])
    expect([valid(parseRecipe({ ...e7, version: 2 })), sweepRecipe(e7).length]).toEqual([33, 33])
    expect([valid(e8), sweepRecipe(e8).length]).toEqual([14, 29])
    expect(valid(parseRecipe({ ...e8, version: 2, base: lowest }))).toBe(29)
  })

  test('named surfaces are bounded in the based design space', () => {
    const raised = (surfaceY: number) =>
      ({
        ...structuredClone(shelfRecipe),
        version: 2,
        base: 100,
        parts: [
          {
            id: 'block',
            label: 'Block',
            count: 1,
            shapes: [
              {
                id: 'b',
                primitive: 'box',
                slot: 'frame',
                size: [1, 1, 1],
                position: [0, 100.5, 0],
              },
            ],
          },
        ],
        parameters: [
          { id: 'unused', label: 'Unused', default: 1, min: 1, max: 1, step: 1, unit: 'count' },
        ],
        surfaces: [{ id: 'top', label: 'Top', position: [0, surfaceY, 0], size: [0.5, 0.5] }],
      }) as Recipe
    expect(evaluateRecipe(parseRecipe(raised(101))).surfaces[0]!.position[1]).toBeCloseTo(1)
    expect(() => parseRecipe(raised(0))).toThrow('surface')
  })

  test('the exported schema and the evaluator refuse a v1 or mounted base', () => {
    expect(RecipeSchema.safeParse({ ...structuredClone(shelfRecipe), base: 0 }).success).toBe(false)
    expect(
      RecipeSchema.safeParse({ ...structuredClone(shelfRecipe), version: 2, base: 0 }).success,
    ).toBe(true)
    const mounted = { ...structuredClone(radiatorRecipe), version: 2, base: 0 }
    expect(RecipeSchema.safeParse(mounted).success).toBe(false)
    expect(() => evaluateRecipe({ ...structuredClone(shelfRecipe), base: 0.1 } as Recipe)).toThrow(
      'version 2',
    )
  })
})
