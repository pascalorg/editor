import { describe, expect, test } from 'bun:test'
import cabinetJson from './__fixtures__/cabinet_two_doors_drawer.json'
import pendantJson from './__fixtures__/pendant_lamp.json'
import e3CompactJson from './__fixtures__/trial_e3_kitchen_compact.json'
import e3DirectJson from './__fixtures__/trial_e3_kitchen_direct.json'
import e7Json from './__fixtures__/trial_e7_pendant_fixed_top.json'
import { shelfRecipe } from './fixtures'
import { type Expr, evaluateRecipe, parseRecipe, type Recipe } from './recipe'

const v2 = (recipe: Recipe): Recipe => ({ ...structuredClone(recipe), version: 2 })
const drops = [0.79, 0.59, 0.75, 0.48, 0.64]
// Trial E7: five cord drops, one per repeat. v1 needed sum_k drop_k * max(0, 1 - |index - k|).
const pendant = (drop: Expr, version: 1 | 2 = 2): Recipe => ({
  version,
  name: 'Five drops',
  description: 'One cord length per repeat.',
  parameters: drops.map((value, k) => ({
    id: `drop_${k + 1}`,
    label: `Drop ${k + 1}`,
    default: value,
    min: 0.3,
    max: 0.9,
    step: 0.01,
    unit: 'm' as const,
  })),
  slots: [{ id: 'cord', label: 'Cord', color: '#222222' }],
  parts: [
    {
      id: 'drop',
      label: 'Drop',
      count: 5,
      shapes: [
        {
          id: 'cord',
          primitive: 'box',
          slot: 'cord',
          size: [0.01, drop, 0.01],
          position: [{ op: 'mul', args: ['index', 0.24] }, { op: 'div', args: [drop, 2] }, 0],
        },
      ],
    },
  ],
  constraints: [],
})
const deltaSum: Expr = {
  op: 'add',
  args: drops.map((_, k) => ({
    op: 'mul' as const,
    args: [
      `drop_${k + 1}`,
      {
        op: 'max' as const,
        args: [
          0,
          {
            op: 'sub' as const,
            args: [1, { op: 'abs' as const, args: [{ op: 'sub' as const, args: ['index', k] }] }],
          },
        ],
      },
    ] as Expr[],
  })),
}
const table: Expr = { op: 'select', args: ['index', ...drops.map((_, k) => `drop_${k + 1}`)] }

describe('select, bool and choice parameters, and when (recipe version 2)', () => {
  test('select picks one value per repeat: E7 drops without the delta-sum encoding', () => {
    const a = evaluateRecipe(parseRecipe(pendant(table)), { drop_3: 0.9 })
    const b = evaluateRecipe(parseRecipe(pendant(deltaSum)), { drop_3: 0.9 })
    expect(a.shapes.map((s) => s.size[1])).toEqual([0.79, 0.59, 0.9, 0.48, 0.64])
    expect(a.shapes).toEqual(b.shapes)
    expect(JSON.stringify(table).length * 4).toBeLessThan(JSON.stringify(deltaSum).length)
  })

  test('select needs an integral index in range and evaluates only the chosen branch', () => {
    const lazy: Expr = { op: 'select', args: [0, 0.5, { op: 'div', args: [1, 0] }] }
    expect(
      evaluateRecipe(parseRecipe(pendant({ op: 'add', args: [table, 0] }))).shapes,
    ).toHaveLength(5)
    expect(() => parseRecipe(pendant({ op: 'max', args: [lazy, 0.4] }))).not.toThrow()
    const outside: Expr = { op: 'select', args: [{ op: 'add', args: ['index', 1] }, 1, 2, 3, 4, 5] }
    expect(() => parseRecipe(pendant(outside))).toThrow('select index')
    const fraction: Expr = { op: 'select', args: [0.5, 0.4, 0.5] }
    expect(() => parseRecipe(pendant(fraction))).toThrow('select index')
  })

  test('a bool parameter keeps or drops whole parts through when', () => {
    const recipe = v2(parseRecipe(structuredClone(cabinetJson)))
    recipe.parameters.push({
      id: 'with_drawer',
      label: 'With drawer',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: 'bool',
    })
    recipe.parts.find((part) => part.id === 'drawer')!.when = 'with_drawer'
    const parsed = parseRecipe(recipe)
    const on = evaluateRecipe(parsed)
    const off = evaluateRecipe(parsed, { with_drawer: 0 })
    expect(on.shapes.some((s) => s.partId === 'drawer')).toBe(true)
    expect(off.shapes.some((s) => s.partId === 'drawer')).toBe(false)
    expect(off.motions.some((m) => m.partId === 'drawer')).toBe(false)
    expect(on.motions.map((m) => m.id)).toEqual(
      evaluateRecipe(parseRecipe(structuredClone(cabinetJson))).motions.map((m) => m.id),
    )
    expect(() => evaluateRecipe(parsed, { with_drawer: 0.5 })).toThrow()
  })

  test('a choice parameter selects shapes and values by option index', () => {
    const recipe = v2(shelfRecipe)
    recipe.parameters.push({
      id: 'finish',
      label: 'Top',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      unit: 'choice',
      options: ['Flat', 'Raised', 'None'],
    })
    const frame = recipe.parts[0]!
    const top = structuredClone(frame.shapes[0]!)
    top.id = 'cap'
    top.when = { op: 'select', args: ['finish', 1, 1, 0] }
    top.size = [top.size[0], { op: 'select', args: ['finish', 0.02, 0.05, 0.02] }, top.size[2]]
    frame.shapes.push(top)
    const parsed = parseRecipe(recipe)
    const cap = (finish: number) =>
      evaluateRecipe(parsed, { finish }).shapes.find((s) => s.id.endsWith(':cap'))
    expect(cap(0)!.size[1]).toBe(0.02)
    expect(cap(1)!.size[1]).toBe(0.05)
    expect(cap(2)).toBeUndefined()
  })

  test('excluded repeats drop their named surfaces; kept ones keep stable IDs', () => {
    const recipe = v2(shelfRecipe)
    const shelves = recipe.parts.find((part) => part.id === 'shelves')!
    shelves.when = { op: 'mod', args: [{ op: 'add', args: ['index', 1] }, 2] }
    recipe.surfaces = [
      { id: 'row', label: 'Row', part: 'shelves', position: [0, 'index', 0], size: [0.2, 0.2] },
    ]
    const ids = evaluateRecipe(parseRecipe(recipe)).surfaces.map((s) => s.id)
    expect(ids.filter((id) => id.startsWith('row:'))).toEqual(
      evaluateRecipe(v2(shelfRecipe))
        .shapes.filter((s) => s.partId === 'shelves')
        .map((s) => Number(s.id.split(':')[1]))
        .filter((i) => i % 2 === 0)
        .map((i) => `row:${i}`),
    )
  })

  test('bool and choice parameters are validated and v2-only', () => {
    const bool = { id: 'b', label: 'B', default: 1, min: 0, max: 1, step: 1, unit: 'bool' as const }
    const withParam = (parameter: Record<string, unknown>, version: 1 | 2 = 2) =>
      ({
        ...structuredClone(shelfRecipe),
        version,
        parameters: [...shelfRecipe.parameters, parameter],
      }) as Recipe
    expect(() => parseRecipe(withParam(bool))).not.toThrow()
    expect(() => parseRecipe(withParam(bool, 1))).toThrow('version 2')
    expect(() => parseRecipe(withParam({ ...bool, max: 2 }))).toThrow()
    expect(() => parseRecipe(withParam({ ...bool, axis: 'x' }))).toThrow()
    const choice = { ...bool, max: 2, default: 0, unit: 'choice', options: ['A', 'B', 'C'] }
    expect(() => parseRecipe(withParam(choice))).not.toThrow()
    expect(() => parseRecipe(withParam({ ...choice, options: ['A', 'B'] }))).toThrow()
    expect(() => parseRecipe(withParam({ ...bool, options: ['A', 'B'] }))).toThrow()
    expect(() => parseRecipe(pendant(table, 1))).toThrow('version 2')
    const when = structuredClone(shelfRecipe)
    when.parts[0]!.when = 1
    expect(() => parseRecipe(when)).toThrow('version 2')
  })

  test('a repeat whose shapes are all skipped builds no light', () => {
    const recipe = v2(parseRecipe(structuredClone(pendantJson)))
    const bulb = recipe.parts.find((part) => part.light)!
    for (const shape of bulb.shapes) shape.when = 0
    const e = evaluateRecipe(parseRecipe(recipe))
    expect(e.lights).toEqual([])
    expect(e.shapes.some((shape) => shape.partId === bulb.id)).toBe(false)
  })
})

describe('options review fixes (AK-10b round 2)', () => {
  test('a skipped repeat allocates no motion group and survivors keep their ids', () => {
    const recipe = v2(parseRecipe(structuredClone(cabinetJson)))
    const doors = recipe.parts.find((part) => part.id === 'doors')!
    for (const shape of doors.shapes)
      shape.when = { op: 'sub', args: [1, { op: 'mod', args: ['index', 2] }] } as Expr
    const e = evaluateRecipe(parseRecipe(recipe))
    const all = evaluateRecipe(parseRecipe(structuredClone(cabinetJson)))
    expect(e.motions.filter((m) => m.partId === 'doors').map((m) => m.id)).toEqual(['doors'])
    for (const shape of doors.shapes) shape.when = { op: 'mod', args: ['index', 2] } as Expr
    const odd = evaluateRecipe(parseRecipe(recipe))
    expect(odd.motions.filter((m) => m.partId === 'doors').map((m) => m.id)).toEqual(
      all.motions
        .filter((m) => m.partId === 'doors')
        .slice(1)
        .map((m) => m.id),
    )
    expect(new Set(odd.shapes.map((s) => s.motionGroup).filter(Boolean))).toEqual(
      new Set(odd.motions.map((m) => m.id)),
    )
  })

  test('mutually exclusive variants may use one emissive slot in different colors', () => {
    const recipe = v2(parseRecipe(structuredClone(pendantJson)))
    recipe.parameters.push({
      id: 'warm',
      label: 'Warm',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: 'bool',
    })
    const bulb = recipe.parts.find((part) => part.light)!
    const cold = structuredClone(bulb)
    cold.id = 'cold_bulb'
    cold.light!.color = '#dfefff'
    bulb.when = 'warm'
    cold.when = { op: 'sub', args: [1, 'warm'] }
    recipe.parts.push(cold)
    const parsed = parseRecipe(recipe)
    expect(evaluateRecipe(parsed).lights.map((l) => l.color)).toEqual([bulb.light!.color])
    expect(evaluateRecipe(parsed, { warm: 0 }).lights.map((l) => l.color)).toEqual(['#dfefff'])
  })

  test('the trial E7 pendant with select evaluates exactly like its delta-sum form', () => {
    const e7 = structuredClone(e7Json) as Recipe
    const delta = e7.parts[1]!.shapes[0]!.size[1]
    const table = {
      op: 'select',
      args: ['index', 'drop_1', 'drop_2', 'drop_3', 'drop_4', 'drop_5'],
    }
    const swap = (value: unknown): unknown =>
      JSON.stringify(value) === JSON.stringify(delta)
        ? table
        : Array.isArray(value)
          ? value.map(swap)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v)]))
            : value
    const compact = { ...(swap(e7) as Recipe), version: 2 as const }
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(e7).length / 1.8)
    const a = evaluateRecipe(parseRecipe({ ...e7, version: 2 }))
    const b = evaluateRecipe(parseRecipe(compact))
    expect(b.shapes).toEqual(a.shapes)
    expect(b.lights).toEqual(a.lights)
  })

  test('the real E3 run compacts under 24 KiB with count and select, box for box', () => {
    const direct = structuredClone(e3DirectJson) as Recipe
    const compact = structuredClone(e3CompactJson) as Recipe
    expect(JSON.stringify(compact).length).toBeLessThan(24 * 1024)
    const key = (s: { size: number[]; position: number[]; slot: string }) =>
      [...s.size, ...s.position].map((v) => v.toFixed(4)).join(',') + s.slot
    const expected = direct.parts.flatMap((part) => part.shapes.map((s) => key(s as never))).sort()
    const evaluation = evaluateRecipe(parseRecipe(compact))
    expect(evaluation.shapes.map(key).sort()).toEqual(expected)
    expect(expected).toHaveLength(323)
  })
})
