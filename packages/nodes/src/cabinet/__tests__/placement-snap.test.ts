import { describe, expect, test } from 'bun:test'
import { resolveCabinetGridPosition } from '../placement-snap'

const DIMENSIONS: [number, number, number] = [0.6, 0.84, 0.58]

describe('cabinet placement grid snap', () => {
  test('aligns the footprint edges to grid lines', () => {
    const position = resolveCabinetGridPosition({
      raw: [0.12, 0, 0.17],
      dimensions: DIMENSIONS,
      yaw: 0,
      step: 0.5,
    })

    expect(position[0]).toBeCloseTo(0.3)
    expect(position[1]).toBe(0)
    expect(position[2]).toBeCloseTo(0.29)
    expect(position[0] - DIMENSIONS[0] / 2).toBeCloseTo(0)
    expect(position[2] - DIMENSIONS[2] / 2).toBeCloseTo(0)
  })

  test('swaps footprint axes after a quarter turn', () => {
    const position = resolveCabinetGridPosition({
      raw: [0.12, 0, 0.17],
      dimensions: DIMENSIONS,
      yaw: Math.PI / 2,
      step: 0.5,
    })

    expect(position[0]).toBeCloseTo(0.29)
    expect(position[1]).toBe(0)
    expect(position[2]).toBeCloseTo(0.3)
  })

  test('preserves free placement when grid snap is disabled', () => {
    expect(
      resolveCabinetGridPosition({
        raw: [0.12, 0, 0.17],
        dimensions: DIMENSIONS,
        yaw: 0,
        step: 0,
      }),
    ).toEqual([0.12, 0, 0.17])
  })
})
