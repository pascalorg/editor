import { expect, test } from 'bun:test'
import type { Expr, ExprV2 } from '../procedural-items/recipe'

// R1: v1 consumers that switch exhaustively over Expr keep compiling; v2 ops live in ExprV2.
function v1Ops(e: Exclude<Expr, number | string>): string {
  switch (e.op) {
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'min':
    case 'max':
    case 'floor':
    case 'ceil':
    case 'round':
    case 'abs':
    case 'sin':
    case 'cos':
    case 'mod':
      return e.op
    default: {
      const unreachable: never = e
      return unreachable
    }
  }
}

test('Expr stays the v1 union; ExprV2 adds select', () => {
  const select: ExprV2 = { op: 'select', args: ['index', 1, 2] }
  expect(v1Ops({ op: 'mod', args: [1, 2] })).toBe('mod')
  expect(select.op).toBe('select')
})
