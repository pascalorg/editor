import { describe, expect, test } from 'bun:test'
import gridTable from './__fixtures__/grid-table.json'
import { ProceduralItemNode } from './node'
import { type Expr, evaluateRecipe, parseRecipe, RecipeSchema, sweepRecipe } from './recipe'

const withExpression = (expression: Expr) => {
  const recipe = parseRecipe(gridTable)
  recipe.parts[0]!.shapes[0]!.position[0] = expression
  return recipe
}

describe('bounded recipe arithmetic', () => {
  test.each([
    ['floor', 1.9, 1],
    ['floor', -1.1, -2],
    ['ceil', 1.1, 2],
    ['ceil', -1.9, -1],
    ['round', 1.5, 2],
    ['round', -1.5, -1],
    ['round', -1.6, -2],
    ['abs', -1.5, 1.5],
    ['abs', 1.5, 1.5],
    ['abs', -0, 0],
    ['sin', Math.PI / 2, 1],
    ['cos', Math.PI, -1],
  ] as const)('%s(%s) = %s', (op, value, expected) => {
    const recipe = parseRecipe(withExpression({ op, args: [value] }))
    expect(evaluateRecipe(recipe).shapes[0]!.position[0]).toBe(expected)
  })

  test.each([
    [5, 2, 1],
    [-5, 2, 1],
    [5.5, 2, 1.5],
    [-5.5, 2, 0.5],
    [-4, 2, 0],
    [0, 2, 0],
    [1, 0.25, 0],
  ])('mod(%s, %s) = %s', (value, divisor, expected) => {
    const recipe = parseRecipe(withExpression({ op: 'mod', args: [value!, divisor!] }))
    expect(evaluateRecipe(recipe).shapes[0]!.position[0]).toBe(expected!)
  })

  test.each([0, -0, -2])('mod rejects divisor %s', (divisor) => {
    expect(() => parseRecipe(withExpression({ op: 'mod', args: [1, divisor] }))).toThrow(
      'Modulo divisor must be positive',
    )
  })

  test('operator arities are strict and existing operators still need 2–8 arguments', () => {
    for (const op of [
      'floor',
      'ceil',
      'round',
      'abs',
      'sin',
      'cos',
      'mod',
      'add',
      'sub',
      'mul',
      'div',
      'min',
      'max',
    ]) {
      for (const count of [0, 1, 2, 3, 8, 9]) {
        const recipe = structuredClone(gridTable)
        recipe.parts[0]!.count = { op, args: Array(count).fill(1) } as never
        const valid = ['floor', 'ceil', 'round', 'abs', 'sin', 'cos'].includes(op)
          ? count === 1
          : op === 'mod'
            ? count === 2
            : count >= 2 && count <= 8
        expect(RecipeSchema.safeParse(recipe).success).toBe(valid)
      }
    }
  })

  test('new operators still reject invalid intermediate results', () => {
    for (const op of ['floor', 'ceil', 'round', 'abs', 'sin', 'cos'] as const) {
      for (const args of [
        [1, 0],
        [1000, 0.001],
      ]) {
        expect(() => parseRecipe(withExpression({ op, args: [{ op: 'div', args }] }))).toThrow(
          'Invalid expression result',
        )
      }
    }
    const invalidModulo = withExpression({ op: 'mod', args: [1, { op: 'div', args: [1, 0] }] })
    expect(() => parseRecipe(invalidModulo)).toThrow('Invalid expression result')
  })

  test('new operators consume the shared expression budget under repetition', () => {
    const leaf: Expr = {
      op: 'floor',
      args: [
        {
          op: 'ceil',
          args: [
            {
              op: 'round',
              args: [
                {
                  op: 'abs',
                  args: [
                    {
                      op: 'sin',
                      args: [{ op: 'cos', args: [{ op: 'mod', args: [Math.PI / 2, 2] }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const branch: Expr = { op: 'add', args: Array(8).fill(leaf) }
    const tree: Expr = { op: 'add', args: Array(8).fill(branch) }
    const recipe = withExpression(tree)
    recipe.parts = [recipe.parts[0]!]
    recipe.parts[0]!.shapes[0]!.position[2] = tree
    recipe.parts[0]!.count = 32
    expect(evaluateRecipe(parseRecipe(recipe)).shapes).toHaveLength(32)
    recipe.parts[0]!.count = 64
    expect(() => parseRecipe(recipe)).toThrow('Expression budget exceeded')
  })

  test('unary nesting still consumes the expression depth budget', () => {
    let expression: Expr = 0
    for (let i = 0; i < 17; i++) expression = { op: 'floor', args: [expression] }
    const recipe = withExpression(expression)
    expect(() => evaluateRecipe(recipe)).toThrow('Expression budget exceeded')
    expect(() => parseRecipe(recipe)).toThrow('structural budget')
  })
})

test('documented 2x2 legs keep table bounds at nominal width and depth across the sweep', () => {
  const recipe = parseRecipe(gridTable)
  const cases = sweepRecipe(recipe)
  expect(cases.every((entry) => entry.valid)).toBe(true)
  for (const { values } of cases) {
    const result = evaluateRecipe(recipe, values)
    const { width, depth, leg_thickness: thickness } = result.parameters
    expect(result.dimensions[0]).toBeCloseTo(width!, 12)
    expect(result.dimensions[2]).toBeCloseTo(depth!, 12)
    expect(result.min[0]).toBeCloseTo(-width! / 2, 12)
    expect(result.max[0]).toBeCloseTo(width! / 2, 12)
    expect(result.min[2]).toBeCloseTo(-depth! / 2, 12)
    expect(result.max[2]).toBeCloseTo(depth! / 2, 12)
    const legs = result.shapes.filter((shape) => shape.partId === 'legs')
    expect(legs).toHaveLength(4)
    const x = (width! - thickness!) / 2
    const z = (depth! - thickness!) / 2
    for (const [i, [sx, sz]] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ].entries()) {
      expect(legs[i]!.position[0]).toBeCloseTo(sx! * x, 12)
      expect(legs[i]!.position[2]).toBeCloseTo(sz! * z, 12)
    }
  }
  const node = ProceduralItemNode.parse({ recipe })
  expect(ProceduralItemNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
})

test('existing div keeps fractional index spacing and saved recipe bounds', () => {
  const recipe = parseRecipe(gridTable)
  const position = recipe.parts[1]!.shapes[0]!.position
  position[0] = {
    op: 'mul',
    args: [
      { op: 'sub', args: [{ op: 'mul', args: [{ op: 'div', args: ['index', 2] }, 2] }, 1] },
      0.205,
    ],
  }
  const restored = parseRecipe(JSON.parse(JSON.stringify(recipe)))
  const result = evaluateRecipe(restored)
  expect(restored).toEqual(recipe)
  expect(result.min[0]).toBeCloseTo(-0.225, 12)
  expect(result.max[0]).toBeCloseTo(0.43, 12)
  expect(result.dimensions[0]).toBeCloseTo(0.655, 12)
})
