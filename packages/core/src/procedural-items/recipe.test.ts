import { describe, expect, test } from 'bun:test'
import { bedRecipe, radiatorRecipe, shelfRecipe } from './fixtures'
import { ProceduralItemNode } from './node'
import { evaluateRecipe, parseRecipe, sweepRecipe } from './recipe'

describe('procedural recipe contract', () => {
  test('slots accept only optional glass finish and still require a color', () => {
    const recipe = structuredClone(shelfRecipe)
    expect(parseRecipe(recipe)).toEqual(recipe)
    recipe.slots[0]!.finish = 'glass'
    expect(parseRecipe(recipe).slots[0]!.finish).toBe('glass')
    for (const slot of [
      { ...recipe.slots[0], finish: 'metal' },
      { ...recipe.slots[0], finish: 'wood' },
      { ...recipe.slots[0], texture: 'glass' },
      { ...recipe.slots[0], color: undefined },
    ]) {
      expect(() => parseRecipe({ ...recipe, slots: [slot, ...recipe.slots.slice(1)] })).toThrow()
    }
  })
  for (const recipe of [shelfRecipe, bedRecipe])
    test(`${recipe.name} survives extrema and combinations`, () => {
      expect(sweepRecipe(recipe).filter((c) => !c.valid)).toEqual([])
    })
  test('widening the bed preserves height and pillow contact', () => {
    const a = evaluateRecipe(bedRecipe, { width: 1 }),
      b = evaluateRecipe(bedRecipe, { width: 2.2 })
    const shape = (r: typeof a, id: string) => r.shapes.find((s) => s.partId === id)!
    expect(shape(a, 'frame').size[1]).toBe(shape(b, 'frame').size[1])
    expect(shape(b, 'pillows').position[0]).toBeLessThan(shape(a, 'pillows').position[0])
    const mattress = shape(b, 'mattress'),
      pillow = shape(b, 'pillows')
    expect(pillow.position[1] - pillow.size[1] / 2).toBeCloseTo(
      mattress.position[1] + mattress.size[1] / 2,
    )
  })
  test('shelf surface IDs survive dimension edits and move vertically', () => {
    const a = evaluateRecipe(shelfRecipe),
      b = evaluateRecipe(shelfRecipe, { height: 2.4 })
    expect(a.surfaces.map((s) => s.id)).toEqual(b.surfaces.map((s) => s.id))
    expect(b.surfaces.at(-1)!.position[1]).toBeGreaterThan(a.surfaces.at(-1)!.position[1])
  })
  test('an occupied row cannot disappear', () => {
    const id = 'item_book',
      surface = evaluateRecipe(shelfRecipe).surfaces.at(-1)!.id
    const node = ProceduralItemNode.parse({
      recipe: shelfRecipe,
      children: [id],
      attachments: { [id]: surface },
    })
    expect(ProceduralItemNode.safeParse({ ...node, parameters: { rows: 2 } }).success).toBe(false)
    expect(
      ProceduralItemNode.safeParse({ ...node, children: [], parameters: { rows: 2 } }).success,
    ).toBe(true)
  })
  test('unknown parameters and nonintegral counts are rejected', () => {
    expect(() => evaluateRecipe(shelfRecipe, { rows: 2.5 })).toThrow()
    expect(() => evaluateRecipe(shelfRecipe, { width: NaN })).toThrow()
    expect(() => evaluateRecipe(shelfRecipe, { banana: 1 })).toThrow()
  })
  test('recipes cannot execute strings, divide by zero, or expand unbounded geometry', () => {
    const r = structuredClone(shelfRecipe)
    r.parts[0]!.count = 'fetch(url)'
    expect(() => parseRecipe(r)).toThrow()
    r.parts[0]!.count = { op: 'div', args: [1, 0] }
    expect(() => parseRecipe(r)).toThrow()
    r.parts[0]!.count = 1000000
    expect(() => parseRecipe(r)).toThrow()
  })
  test('unknown slots and duplicate IDs fail before rendering', () => {
    const r = structuredClone(shelfRecipe)
    r.parts[0]!.shapes[0]!.slot = 'missing'
    expect(() => parseRecipe(r)).toThrow('Unknown slot')
    r.parts[0]!.shapes[0]!.slot = 'frame'
    r.parameters.push(r.parameters[0]!)
    expect(() => parseRecipe(r)).toThrow('unique')
  })
  test('recipe and instance round trip retains overrides and identity', () => {
    const n = ProceduralItemNode.parse({
      recipe: bedRecipe,
      parameters: { width: 2 },
      slots: { wood: '#abcdef' },
    })
    expect(ProceduralItemNode.parse(JSON.parse(JSON.stringify(n)))).toEqual(n)
  })
  test('deep expressions and reserved object keys fail', () => {
    const r = structuredClone(shelfRecipe)
    let e: any = 1
    for (let i = 0; i < 40; i++) e = { op: 'add', args: [e, 1] }
    r.parts[0]!.count = e
    expect(() => parseRecipe(r)).toThrow('budget')
    expect(() => parseRecipe(JSON.parse('{"__proto__":{}}'))).toThrow('Reserved')
  })
})

test('named surfaces repeat with stable IDs and reject invalid mounting references', () => {
  const recipe = structuredClone(shelfRecipe)
  recipe.surfaces = [
    {
      id: 'named_shelf',
      label: 'Shelf region',
      part: 'shelves',
      position: [0, 'index', 0],
      size: ['width', 'depth'],
    },
  ]
  const a = evaluateRecipe(parseRecipe(recipe))
  const b = evaluateRecipe(recipe, { width: 2 })
  expect(a.surfaces.map((s) => s.id)).toEqual(b.surfaces.map((s) => s.id))
  expect(a.surfaces.some((s) => s.id === 'named_shelf:0')).toBe(true)
  const radiator = structuredClone(radiatorRecipe)
  radiator.surfaces![0]!.rotation = [0, 0, 0]
  expect(() => parseRecipe(radiator)).toThrow('face local -Z')
  radiator.mounting!.reference = 'missing'
  expect(() => parseRecipe(radiator)).toThrow('reference surface')
})
