import { describe, expect, test } from 'bun:test'
import { planLinesetConnect } from './connect'
import type { LinesetNode } from './schema'

type Point = [number, number, number]

/** Minimal stand-in — the planner only reads `id` and `path`. */
function line(id: string, path: Point[]): LinesetNode {
  return { id, path } as unknown as LinesetNode
}

describe('planLinesetConnect', () => {
  test('no shared endpoint → create', () => {
    const plan = planLinesetConnect([line('a', [[0, 0, 0], [1, 0, 0]])], [5, 0, 0], [6, 0, 0])
    expect(plan).toEqual({ kind: 'create', path: [[5, 0, 0], [6, 0, 0]] })
  })

  test('new start meets run end → extend, old end becomes interior', () => {
    const a = line('a', [[0, 0, 0], [1, 0, 0]])
    const plan = planLinesetConnect([a], [1, 0, 0], [1, 0, 2])
    expect(plan).toEqual({ kind: 'extend', id: 'a', path: [[0, 0, 0], [1, 0, 0], [1, 0, 2]] })
  })

  test('new start meets run start → extend, run reversed so join is interior', () => {
    const a = line('a', [[0, 0, 0], [1, 0, 0]])
    const plan = planLinesetConnect([a], [0, 0, 0], [0, 0, 2])
    expect(plan).toEqual({ kind: 'extend', id: 'a', path: [[1, 0, 0], [0, 0, 0], [0, 0, 2]] })
  })

  test('new end meets a run → extend, new segment leads', () => {
    const a = line('a', [[1, 0, 0], [2, 0, 0]])
    const plan = planLinesetConnect([a], [1, 0, 3], [1, 0, 0])
    expect(plan).toEqual({ kind: 'extend', id: 'a', path: [[1, 0, 3], [1, 0, 0], [2, 0, 0]] })
  })

  test('both ends meet distinct runs → bridge, second run absorbed', () => {
    const a = line('a', [[0, 0, 0], [1, 0, 0]])
    const b = line('b', [[1, 0, 5], [2, 0, 5]])
    const plan = planLinesetConnect([a, b], [1, 0, 0], [1, 0, 5])
    expect(plan).toEqual({
      kind: 'bridge',
      id: 'a',
      deleteId: 'b',
      path: [[0, 0, 0], [1, 0, 0], [1, 0, 5], [2, 0, 5]],
    })
  })

  test('both ends meet the SAME run → not a bridge (extends at start)', () => {
    const a = line('a', [[0, 0, 0], [1, 0, 0]])
    const plan = planLinesetConnect([a], [0, 0, 0], [1, 0, 0])
    expect(plan.kind).toBe('extend')
  })

  test('float drift within tolerance still coincides', () => {
    const a = line('a', [[0, 0, 0], [1, 0, 0]])
    const plan = planLinesetConnect([a], [1.0000001, 0, 0], [1, 0, 2])
    expect(plan.kind).toBe('extend')
  })
})
