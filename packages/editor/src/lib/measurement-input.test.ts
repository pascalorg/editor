import { describe, expect, test } from 'bun:test'
import {
  applyFixedLength,
  bareLengthUnit,
  isMeasurementInputContinueKey,
  isMeasurementInputStartKey,
  resolveMeasurementInput,
} from './measurement-input'

describe('bareLengthUnit', () => {
  test('follows the viewer display preference', () => {
    expect(bareLengthUnit('metric', 'meters')).toBe('m')
    expect(bareLengthUnit('metric', 'millimeters')).toBe('mm')
    expect(bareLengthUnit('imperial')).toBe('ft')
  })
})

describe('isMeasurementInputStartKey', () => {
  test('digits and decimal separators start a buffer', () => {
    for (const key of ['0', '4', '9', '.', ',']) {
      expect(isMeasurementInputStartKey(key)).toBe(true)
    }
  })

  test('tool shortcut letters never start a buffer', () => {
    for (const key of ['b', 'v', 'm', 'x', 'p', 'g', 'f', 'z', 'r', 't', 'e', 'c', 'j']) {
      expect(isMeasurementInputStartKey(key)).toBe(false)
    }
  })

  test('named keys never start a buffer', () => {
    for (const key of ['Enter', 'Escape', 'Shift', 'ArrowUp', 'Backspace']) {
      expect(isMeasurementInputStartKey(key)).toBe(false)
    }
  })

  test('letters continue a started buffer so units can be spelled', () => {
    expect(isMeasurementInputContinueKey('m')).toBe(true)
    expect(isMeasurementInputContinueKey('"')).toBe(true)
    expect(isMeasurementInputContinueKey(' ')).toBe(false)
    expect(isMeasurementInputContinueKey('Enter')).toBe(false)
  })
})

describe('resolveMeasurementInput', () => {
  test('reads a bare number in the model unit', () => {
    expect(resolveMeasurementInput('4.2', 'length', 'm')).toBeCloseTo(4.2, 6)
    expect(resolveMeasurementInput('4200', 'length', 'mm')).toBeCloseTo(4.2, 6)
  })

  test('an explicit unit overrides the model unit', () => {
    expect(resolveMeasurementInput('4200mm', 'length', 'm')).toBeCloseTo(4.2, 6)
    expect(resolveMeasurementInput('180cm', 'length', 'm')).toBeCloseTo(1.8, 6)
  })

  test('accepts a comma decimal separator', () => {
    expect(resolveMeasurementInput('4,2', 'length', 'm')).toBeCloseTo(4.2, 6)
  })

  test('reads imperial feet-and-inches', () => {
    const value = resolveMeasurementInput('5\'11"', 'length', 'ft')
    expect(value).not.toBeNull()
    expect(value as number).toBeCloseTo(1.8034, 3)
  })

  test('angles resolve to radians and default to degrees', () => {
    const ninety = resolveMeasurementInput('90', 'angle', 'm')
    expect(ninety).not.toBeNull()
    expect(ninety as number).toBeCloseTo(Math.PI / 2, 6)
  })

  test('incomplete text yields null so the cursor keeps driving', () => {
    expect(resolveMeasurementInput('', 'length', 'm')).toBeNull()
    expect(resolveMeasurementInput('   ', 'length', 'm')).toBeNull()
    expect(resolveMeasurementInput('abc', 'length', 'm')).toBeNull()
  })
})

describe('applyFixedLength', () => {
  test('places the point at the typed distance along the cursor direction', () => {
    const result = applyFixedLength([0, 0], [10, 0], 4.2)
    expect(result).not.toBeNull()
    const [x, y] = result as readonly [number, number]
    expect(x).toBeCloseTo(4.2, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  test('keeps the direction, not the cursor distance', () => {
    // Cursor is 5 units out on a 3-4-5 triangle; typed length is 10.
    const result = applyFixedLength([0, 0], [3, 4], 10)
    const [x, y] = result as readonly [number, number]
    expect(x).toBeCloseTo(6, 6)
    expect(y).toBeCloseTo(8, 6)
    expect(Math.hypot(x, y)).toBeCloseTo(10, 6)
  })

  test('works from a non-origin start', () => {
    const result = applyFixedLength([2, 1], [2, 9], 3)
    const [x, y] = result as readonly [number, number]
    expect(x).toBeCloseTo(2, 6)
    expect(y).toBeCloseTo(4, 6)
  })

  test('a degenerate direction has no answer', () => {
    expect(applyFixedLength([1, 1], [1, 1], 4)).toBeNull()
    expect(applyFixedLength([1, 1], [1 + 1e-12, 1], 4)).toBeNull()
  })

  test('a zero or non-finite length has no answer', () => {
    expect(applyFixedLength([0, 0], [1, 0], 0)).toBeNull()
    expect(applyFixedLength([0, 0], [1, 0], Number.NaN)).toBeNull()
  })
})
