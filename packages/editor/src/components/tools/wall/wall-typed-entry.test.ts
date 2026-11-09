import { describe, expect, test } from 'bun:test'
import {
  formatWallDraftHeading,
  resolveTypedWallEnd,
  wallDraftHeadingDegrees,
} from './wall-typed-entry'

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

describe('resolveTypedWallEnd — angle', () => {
  test('angle only locks the heading; the pointer projection sets the length', () => {
    // 90° runs along +Z; a pointer at (1, 3) projects to 3 m along it.
    expectPoint(resolveTypedWallEnd([0, 0], [1, 3], ['', '90'], metric), [0, 3])
    // (3, 4) projects to 7/√2 along 45°, landing 3.5 out on each axis.
    expectPoint(resolveTypedWallEnd([1, 1], [4, 5], ['', '45'], metric), [4.5, 4.5])
  })

  test('angle only quantises the projected length to the step', () => {
    expectPoint(resolveTypedWallEnd([0, 0], [0.2, 2.37], ['', '90'], metric, 0.5), [0, 2.5])
  })

  test('angle only never flips the wall behind its start', () => {
    expectPoint(resolveTypedWallEnd([0, 0], [-4, 0.1], ['', '0'], metric), [0, 0])
  })

  test('length and angle fix the endpoint whatever the pointer does', () => {
    expectPoint(resolveTypedWallEnd([2, 1], [-50, 80], ['4', '180'], metric), [-2, 1])
    expectPoint(resolveTypedWallEnd([0, 0], [0, 0], ['2', '270'], metric), [0, -2])
    expectPoint(resolveTypedWallEnd([0, 0], [5, 5], ['1', '-90'], metric), [0, -1])
  })

  test('accepts degree and radian suffixes', () => {
    expectPoint(resolveTypedWallEnd([0, 0], [9, 9], ['2', '90°'], metric), [0, 2])
    expectPoint(resolveTypedWallEnd([0, 0], [9, 9], ['2', `${Math.PI}rad`], metric), [-2, 0])
  })

  test('an unreadable angle leaves the direction to the pointer', () => {
    expectPoint(resolveTypedWallEnd([0, 0], [0, 4], ['2', 'x'], metric), [0, 2])
    expect(resolveTypedWallEnd([0, 0], [0, 4], ['', 'x'], metric)).toBeNull()
  })
})

describe('wallDraftHeadingDegrees', () => {
  test('measures from +X towards +Z in [0, 360)', () => {
    expect(wallDraftHeadingDegrees([0, 0], [1, 0])).toBeCloseTo(0, 10)
    expect(wallDraftHeadingDegrees([0, 0], [0, 1])).toBeCloseTo(90, 10)
    expect(wallDraftHeadingDegrees([0, 0], [-1, 0])).toBeCloseTo(180, 10)
    expect(wallDraftHeadingDegrees([0, 0], [0, -1])).toBeCloseTo(270, 10)
    expect(wallDraftHeadingDegrees([1, 1], [1, 1])).toBeNull()
  })

  test('round-trips through a typed angle', () => {
    const heading = wallDraftHeadingDegrees([0, 0], [-3, -4])!
    expectPoint(resolveTypedWallEnd([0, 0], [0, 0], ['5', String(heading)], metric), [-3, -4])
  })

  test('labels the live heading in the same convention, wrapping 360° to 0°', () => {
    expect(formatWallDraftHeading([0, 0], [0, 1])).toBe('90°')
    expect(formatWallDraftHeading([0, 0], [1, -1])).toBe('315°')
    expect(formatWallDraftHeading([0, 0], [1, -0.001])).toBe('0°')
    expect(formatWallDraftHeading([0, 0], [0, 0])).toBe('')
  })
})
