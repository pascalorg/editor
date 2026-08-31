import { describe, expect, test } from 'bun:test'
import { planDormerWindowRow } from './window-layout'

describe('planDormerWindowRow', () => {
  test('centres newly added windows next to each other', () => {
    const plan = planDormerWindowRow(2.4, [
      { id: 'window_1', position: [0, -0.8, 0], width: 0.8 },
      { id: 'window_2', position: [0, -0.8, 0], width: 0.8 },
    ])

    expect(plan).not.toBeNull()
    expect(plan?.map((entry) => entry.position)).toEqual([
      [-0.46, -0.8, 0],
      [0.46, -0.8, 0],
    ])
    expect(plan?.map((entry) => entry.width)).toEqual([0.8, 0.8])
  })

  test('shrinks the row proportionally when preferred widths do not fit', () => {
    const plan = planDormerWindowRow(2.4, [
      { id: 'window_1', position: [0, -0.8, 0], width: 0.8 },
      { id: 'window_2', position: [0, -0.8, 0], width: 0.8 },
      { id: 'window_3', position: [0, -0.8, 0], width: 0.8 },
    ])

    expect(plan).not.toBeNull()
    expect(plan?.map((entry) => entry.width)).toEqual([0.64, 0.64, 0.64])
    expect(plan?.map((entry) => entry.position[0])).toEqual([-0.76, 0, 0.76])
  })

  test('rejects a row when minimum-width windows cannot fit', () => {
    const plan = planDormerWindowRow(
      1.2,
      Array.from({ length: 4 }, (_, index) => ({
        id: `window_${index + 1}`,
        position: [0, -0.8, 0] as [number, number, number],
        width: 0.3,
      })),
    )

    expect(plan).toBeNull()
  })
})
