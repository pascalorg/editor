import { describe, expect, spyOn, test } from 'bun:test'
import clipping from 'polygon-clipping'
import {
  area,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type Ring,
  union,
} from './polygon-boolean'

const square: Ring = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

describe('polygon boolean kernel', () => {
  test('touching squares merge with no duplicate or collinear vertices', () => {
    const adjacent: Ring = [
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 0],
    ]
    const merged = union([square, adjacent])
    expect(merged).toEqual([
      {
        outer: [
          [0, 0],
          [2, 0],
          [2, 1],
          [0, 1],
        ],
        holes: [],
      },
    ])
    expect(intersection(square, adjacent)).toEqual([])
    expect(union([adjacent.slice().reverse(), square.slice().reverse()])).toEqual(merged)
  })

  test('square with a hole preserves area, membership, hole rims and boundary distance', () => {
    const outer: Ring = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const hole: Ring = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]
    const result = difference(outer, hole)
    expect(result).toHaveLength(1)
    expect(result[0]!.holes).toHaveLength(1)
    expect(area(result)).toBe(12)
    expect(containsPoint(result, [2, 2])).toBe(false)
    expect(containsPoint(result, [0.5, 2])).toBe(true)
    expect(containsPoint(result, [1, 2])).toBe(true)
    expect(distanceToBoundary(result, [2, 2])).toBe(1)
    expect(distanceToBoundary(result, [5, 2])).toBe(1)
    expect(area(intersection(result, outer))).toBe(12)
    expect(union([result, hole])).toEqual(union([outer]))
  })

  test('quantises inputs to 0.1 mm and removes sub-1e-6 square metre slivers', () => {
    expect(union([square.map(([x, z]) => [x + 0.000_04, z - 0.000_04])])).toEqual(union([square]))
    expect(
      union([
        [
          [0, 0],
          [0.001, 0],
          [0.001, 0.0005],
          [0, 0.0005],
        ],
      ]),
    ).toEqual([])
    expect(
      difference(square, [
        [0.000_000_1, 0],
        [1, 0],
        [1, 1],
        [0.000_000_1, 1],
      ]),
    ).toEqual([])
  })

  test('disconnected components and holes have deterministic ordering', () => {
    const shifted = square.map(([x, z]): [number, number] => [x + 3, z])
    expect(union([shifted, square])).toEqual(union([square, shifted]))
    expect(union([])).toEqual([])
    expect(difference([], square)).toEqual([])
    expect(intersection(square, [])).toEqual([])
    expect(distanceToBoundary([], [0, 0])).toBe(Number.POSITIVE_INFINITY)
  })
  test('quantising a narrow notch preserves its reversal until clipping resolves it', () => {
    const notch: Ring = [
      [0, 0],
      [2, 0],
      [2, 1.99996],
      [1, 1],
      [1.99996, 2],
      [0, 2],
    ]
    const expected = union([
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    ])
    expect(union([notch])).toEqual(expected)
    expect(area(union([notch]))).toBe(4)
    expect(difference(notch, [])).toEqual(expected)
    expect(intersection(notch, expected)).toEqual(expected)
  })

  test('all operations reject non-finite outer and hole coordinates without throwing', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const ring: Ring = [
          [0, 0],
          [invalid, 0],
          [1, 1],
          [0, 1],
        ]
        for (const input of [ring, { outer: square, holes: [ring] }]) {
          expect(union([square, input])).toEqual([])
          expect(difference(square, input)).toEqual([])
          expect(difference(input, square)).toEqual([])
          expect(intersection(square, input)).toEqual([])
        }
      }
    } finally {
      warn.mockRestore()
    }
  })

  test('clipping exceptions return empty polygons in all operations', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const mocks = (['union', 'difference', 'intersection'] as const).map((operation) =>
      spyOn(clipping, operation).mockImplementation(() => {
        throw new Error('clipping failed')
      }),
    )
    try {
      expect(union([square])).toEqual([])
      expect(difference(square, square)).toEqual([])
      expect(difference(square, [])).toEqual([])
      expect(intersection(square, square)).toEqual([])
    } finally {
      for (const mock of mocks) mock.mockRestore()
      warn.mockRestore()
    }
  })

  test('development warns once per failing caller and production stays quiet', () => {
    const environment = process.env.NODE_ENV
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const invalid: Ring = [
      [0, 0],
      [Number.NaN, 1],
      [1, 0],
    ]
    try {
      process.env.NODE_ENV = 'development'
      for (let i = 0; i < 3; i++) expect(union([invalid])).toEqual([])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(union([invalid])).toEqual([])
      expect(warn).toHaveBeenCalledTimes(2)
      process.env.NODE_ENV = 'production'
      expect(union([invalid])).toEqual([])
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      if (environment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = environment
      warn.mockRestore()
    }
  })
})
