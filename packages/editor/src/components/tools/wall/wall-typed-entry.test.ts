import { describe, expect, test } from 'bun:test'
import { resolveTypedWallEnd } from './wall-typed-entry'

const metric = { bareUnit: 'm', system: 'metric' } as const

function expectPoint(actual: [number, number] | null, expected: [number, number]) {
  expect(actual).not.toBeNull()
  expect(actual![0]).toBeCloseTo(expected[0], 10)
  expect(actual![1]).toBeCloseTo(expected[1], 10)
}

describe('resolveTypedWallEnd — length only', () => {
  test('keeps the pointer direction and replaces the distance', () => {
    expectPoint(resolveTypedWallEnd([0, 0], [3, 4], ['1', ''], metric), [0.6, 0.8])
    expectPoint(resolveTypedWallEnd([0, 0], [-30, -40], ['5', ''], metric), [-3, -4])
  })

  test('reads the whole field, not the length the pointer last showed', () => {
    expectPoint(resolveTypedWallEnd([0, 0], [1, 0], ['12', ''], metric), [12, 0])
  })

  test('honours unit suffixes and the bare unit', () => {
    expectPoint(resolveTypedWallEnd([1, 1], [11, 1], ['250cm', ''], metric), [3.5, 1])
    expectPoint(
      resolveTypedWallEnd([0, 0], [0, 9], ['2500', ''], { bareUnit: 'mm', system: 'metric' }),
      [0, 2.5],
    )
    expectPoint(
      resolveTypedWallEnd([0, 0], [9, 0], ["10'", ''], { bareUnit: 'in', system: 'imperial' }),
      [3.048, 0],
    )
  })

  test('has no endpoint without a usable length or a direction', () => {
    expect(resolveTypedWallEnd([0, 0], [1, 0], ['', ''], metric)).toBeNull()
    expect(resolveTypedWallEnd([0, 0], [1, 0], ['abc', ''], metric)).toBeNull()
    expect(resolveTypedWallEnd([0, 0], [1, 0], ['0', ''], metric)).toBeNull()
    expect(resolveTypedWallEnd([2, 2], [2, 2], ['5', ''], metric)).toBeNull()
  })
})
