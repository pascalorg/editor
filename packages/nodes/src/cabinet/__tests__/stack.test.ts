import { describe, expect, test } from 'bun:test'
import {
  type CabinetCompartment,
  normalizeCabinetStack,
  resizeCabinetCompartmentStack,
} from '../stack'

const stack: CabinetCompartment[] = [
  { id: 'drawer', type: 'drawer', height: 0.44, drawerCount: 3 },
  { id: 'shelf', type: 'shelf', height: 0.2, shelfCount: 1 },
  { id: 'door', type: 'door', height: 0.56, doorType: 'double', shelfCount: 2 },
]

describe('resizeCabinetCompartmentStack', () => {
  test('keeps total height constant and redistributes remaining compartments', () => {
    const resized = resizeCabinetCompartmentStack({ width: 0.6, carcassHeight: 1.2, stack }, 0, 0.5)
    const heights = normalizeCabinetStack({ width: 0.6, carcassHeight: 1.2, stack: resized }).map(
      (row) => row.height,
    )

    expect(heights[0]).toBeCloseTo(0.5)
    expect(heights[0]! + heights[1]! + heights[2]!).toBeCloseTo(1.2)
    expect(heights[1]).toBeGreaterThanOrEqual(0.1)
    expect(heights[2]).toBeGreaterThanOrEqual(0.1)
  })

  test('clamps the edited compartment so all siblings keep a minimum height', () => {
    const resized = resizeCabinetCompartmentStack(
      { width: 0.6, carcassHeight: 0.72, stack },
      2,
      0.7,
    )
    const heights = normalizeCabinetStack({ width: 0.6, carcassHeight: 0.72, stack: resized }).map(
      (row) => row.height,
    )

    expect(heights[0]).toBeCloseTo(0.1)
    expect(heights[1]).toBeCloseTo(0.1)
    expect(heights[2]).toBeCloseTo(0.52)
    expect(heights[0]! + heights[1]! + heights[2]!).toBeCloseTo(0.72)
  })
})
