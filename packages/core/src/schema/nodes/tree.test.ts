import { describe, expect, test } from 'bun:test'
import { defaultTreeSpread, resolveTreeParameters, TREE_FORMS } from '../../lib/tree-form'
import { parseNode } from '../compiled-node-parsers'
import { AnyNode } from '../types'
import { TREE_LIMITS, TreeNode } from './tree'

test('a tree stores a ground anchor and derives its default crown width from its form and height', () => {
  const tree = TreeNode.parse({})
  expect(tree).toMatchObject({
    type: 'tree',
    position: [0, 0, 0],
    form: 'round',
    heightM: 8,
    foliage: '#609343',
    density: 0.85,
    seed: 1,
    gen: 1,
  })
  for (const form of TREE_FORMS) {
    const node = TreeNode.parse({ form, heightM: 4 })
    expect(resolveTreeParameters(node).spreadM).toBe(defaultTreeSpread(form, 4))
  }
})

test('an explicit crown width survives parsing, union parsing, saving and compiled parsing', () => {
  const tree = TreeNode.parse({ position: [2, 0, -3], form: 'upright', spreadM: 5 })
  const saved = JSON.parse(JSON.stringify(tree))
  expect(AnyNode.parse(saved)).toEqual(tree)
  expect(parseNode(saved)).toMatchObject({ success: true, data: tree })
  expect(resolveTreeParameters(tree).spreadM).toBe(5)
})

describe('tree bounds', () => {
  test.each([
    { heightM: TREE_LIMITS.minHeight - 0.01 },
    { heightM: TREE_LIMITS.maxHeight + 0.01 },
    { spreadM: TREE_LIMITS.minSpread - 0.01 },
    { spreadM: TREE_LIMITS.maxSpread + 0.01 },
    { density: -0.01 },
    { density: 1.01 },
    { seed: 2147483648 },
    { seed: -2147483649 },
    { seed: 1.5 },
    { gen: 2 },
    { form: 'unknown' },
    { foliage: 'green' },
    { position: [0, 1, 0] },
    { position: [10_001, 0, 0] },
    { heightM: Number.NaN },
    { spreadM: Number.POSITIVE_INFINITY },
  ])('rejects invalid persisted fields: %j', (fields) => {
    expect(TreeNode.safeParse(fields).success).toBe(false)
  })
})
