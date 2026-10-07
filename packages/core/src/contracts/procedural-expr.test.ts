import { expect, test } from 'bun:test'
import type { Expr } from '../procedural-items/recipe'

// Expr is what parsed recipes carry: consumers that switch exhaustively must handle select.
function ops(e: Exclude<Expr, number | string>): string {
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
    case 'select':
      return e.op
    default: {
      const unreachable: never = e
      return unreachable
    }
  }
}

test('Expr includes the version 2 select', () => {
  expect(ops({ op: 'select', args: ['index', 1, 2] })).toBe('select')
  expect(ops({ op: 'mod', args: [1, 2] })).toBe('mod')
})
