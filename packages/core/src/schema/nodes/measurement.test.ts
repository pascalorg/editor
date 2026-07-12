import { describe, expect, test } from 'bun:test'
import { MeasurementNode } from './measurement'

const parseMeasurement = (measurement: unknown) =>
  MeasurementNode.safeParse({
    id: 'measurement_test',
    type: 'measurement',
    measurement,
  })

describe('MeasurementNode', () => {
  test('accepts exactly two finite distance points', () => {
    expect(
      parseMeasurement({
        kind: 'distance',
        points: [
          [0, 1, 2],
          [3, 4, 5],
        ],
      }).success,
    ).toBe(true)

    expect(
      parseMeasurement({
        kind: 'distance',
        points: [
          [0, 1, 2],
          [3, 4, 5],
          [6, 7, 8],
        ],
      }).success,
    ).toBe(false)

    expect(
      parseMeasurement({
        kind: 'distance',
        points: [
          [0, 1, 2],
          [Number.POSITIVE_INFINITY, 4, 5],
        ],
      }).success,
    ).toBe(false)
  })

  test('requires at least three area base points', () => {
    expect(
      parseMeasurement({
        kind: 'area',
        base: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
      }).success,
    ).toBe(true)

    expect(
      parseMeasurement({
        kind: 'area',
        base: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      }).success,
    ).toBe(false)

    expect(
      parseMeasurement({
        kind: 'area',
        base: [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ],
      }).success,
    ).toBe(false)

    expect(
      parseMeasurement({
        kind: 'area',
        base: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0.1, 1],
        ],
      }).success,
    ).toBe(false)
  })

  test('requires a finite extrusion and at least three volume base points', () => {
    expect(
      parseMeasurement({
        kind: 'volume',
        base: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        extrusion: [0, 2, 0],
      }).success,
    ).toBe(true)

    expect(
      parseMeasurement({
        kind: 'volume',
        base: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        extrusion: [0, 2, 0],
      }).success,
    ).toBe(false)

    expect(
      parseMeasurement({
        kind: 'volume',
        base: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        extrusion: [0, Number.NaN, 0],
      }).success,
    ).toBe(false)

    expect(
      parseMeasurement({
        kind: 'volume',
        base: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        extrusion: [2, 0, 0],
      }).success,
    ).toBe(false)
  })
})
