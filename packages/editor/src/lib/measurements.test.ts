import { describe, expect, test } from 'bun:test'
import {
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaLabel,
  formatAreaMeasurement,
  formatLinearMeasurement,
  getAreaUnitLabel,
  getLinearUnitLabel,
  linearControlValueToMeters,
  linearUnitToMeters,
  metersToLinearUnit,
  squareMetersToAreaUnit,
} from './measurements'

describe('linear measurements', () => {
  test('formats metric measurements in meters', () => {
    expect(formatLinearMeasurement(3, 'metric')).toBe('3m')
    expect(formatLinearMeasurement(3.456, 'metric')).toBe('3.46m')
  })

  test('formats metric measurements at selectable precision', () => {
    expect(formatLinearMeasurement(3.4567, 'metric', { precision: 'coarse' })).toBe('3.5m')
    expect(formatLinearMeasurement(3.4567, 'metric', { precision: 'standard' })).toBe('3.46m')
    expect(formatLinearMeasurement(3.4567, 'metric', { precision: 'fine' })).toBe('3.457m')
  })

  test('formats imperial measurements as feet and inches', () => {
    expect(formatLinearMeasurement(3.048, 'imperial')).toBe(`10'0"`)
    expect(formatLinearMeasurement(3.2004, 'imperial')).toBe(`10'6"`)
  })

  test('formats imperial measurements at selectable precision', () => {
    expect(formatLinearMeasurement(0.3302, 'imperial', { precision: 'coarse' })).toBe(`1'1"`)
    expect(formatLinearMeasurement(0.3302, 'imperial', { precision: 'standard' })).toBe(`1'1"`)
    expect(formatLinearMeasurement(0.3302, 'imperial', { precision: 'fine' })).toBe(`1'1"`)
    expect(formatLinearMeasurement(0.3334, 'imperial', { precision: 'fine' })).toBe(`1'1 1/8"`)
  })

  test('carries rounded 12 inches into the next foot', () => {
    expect(formatLinearMeasurement(3.047, 'imperial')).toBe(`10'0"`)
  })

  test('returns a placeholder for non-finite measurements', () => {
    expect(formatLinearMeasurement(NaN, 'imperial')).toBe('--')
    expect(formatLinearMeasurement(Infinity, 'imperial')).toBe('--')
    expect(formatLinearMeasurement(NaN, 'metric')).toBe('--')
  })

  test('formats zero measurements', () => {
    expect(formatLinearMeasurement(0, 'imperial')).toBe(`0'0"`)
    expect(formatLinearMeasurement(0, 'metric')).toBe('0m')
  })

  test('formats sub-foot imperial measurements', () => {
    expect(formatLinearMeasurement(0.1524, 'imperial')).toBe(`0'6"`)
  })

  test('formats negative measurements with a sign', () => {
    expect(formatLinearMeasurement(-0.1524, 'imperial')).toBe(`-0'6"`)
    expect(formatLinearMeasurement(-0.1524, 'metric')).toBe('-0.15m')
  })

  test('converts between meters and the active linear unit', () => {
    expect(metersToLinearUnit(0, 'imperial')).toBe(0)
    expect(linearUnitToMeters(0, 'imperial')).toBe(0)

    expect(metersToLinearUnit(1, 'metric')).toBe(1)
    expect(linearUnitToMeters(1, 'metric')).toBe(1)

    expect(metersToLinearUnit(0.3048, 'imperial')).toBeCloseTo(1)
    expect(linearUnitToMeters(1, 'imperial')).toBeCloseTo(0.3048)
  })

  test('converts numeric control input back to meters for wall panel edits', () => {
    expect(linearControlValueToMeters(10, 'imperial')).toBeCloseTo(3.048)
    expect(linearControlValueToMeters(0.5, 'imperial')).toBeCloseTo(0.1524)
    expect(linearControlValueToMeters(-1, 'imperial')).toBeCloseTo(-0.3048)
    expect(linearControlValueToMeters(3.5, 'metric')).toBe(3.5)
  })

  test('clamps numeric control input after converting to meters', () => {
    expect(linearControlValueToMeters(0.1, 'imperial', { minMeters: 0.1 })).toBe(0.1)
    expect(linearControlValueToMeters(0.3, 'imperial', { minMeters: 0.1 })).toBe(0.1)
    expect(linearControlValueToMeters(19.7, 'imperial', { maxMeters: 6 })).toBe(6)
    expect(linearControlValueToMeters(0.2, 'metric', { minMeters: 0.1 })).toBe(0.2)
    expect(linearControlValueToMeters(0.2, 'metric', { maxMeters: 0.15 })).toBe(0.15)
  })

  test('returns the display label for numeric controls', () => {
    expect(getLinearUnitLabel('metric')).toBe('m')
    expect(getLinearUnitLabel('imperial')).toBe('ft')
  })
})

describe('area measurements', () => {
  test('formats metric surface areas in square meters', () => {
    expect(formatAreaMeasurement(12, 'metric')).toBe('12m²')
    expect(formatAreaMeasurement(12.34, 'metric')).toBe('12.3m²')
  })

  test('formats areas at selectable precision', () => {
    expect(formatAreaMeasurement(12.345, 'metric', { precision: 'coarse' })).toBe('12m²')
    expect(formatAreaMeasurement(12.345, 'metric', { precision: 'standard' })).toBe('12.3m²')
    expect(formatAreaMeasurement(12.345, 'metric', { precision: 'fine' })).toBe('12.35m²')
  })

  test('formats imperial surface areas in rounded square feet', () => {
    expect(formatAreaMeasurement(9.290304, 'imperial')).toBe('100ft²')
  })

  test('returns a placeholder for non-finite areas', () => {
    expect(formatAreaMeasurement(NaN, 'metric')).toBe('--')
    expect(formatAreaMeasurement(Infinity, 'imperial')).toBe('--')
  })

  test('converts square meters to the active area unit', () => {
    expect(squareMetersToAreaUnit(0, 'imperial')).toBe(0)
    expect(squareMetersToAreaUnit(12.5, 'metric')).toBe(12.5)
    expect(squareMetersToAreaUnit(1, 'imperial')).toBeCloseTo(10.7639)
  })

  test('returns the display label for area readouts', () => {
    expect(getAreaUnitLabel('metric')).toBe('m²')
    expect(getAreaUnitLabel('imperial')).toBe('ft²')
  })

  test('formats an area label with value and unit', () => {
    expect(formatAreaLabel(12.34, 'metric')).toBe('12.3m²')
    expect(formatAreaLabel(1, 'imperial')).toBe('10.8ft²')
    expect(formatAreaLabel(12.34, 'metric', 2)).toBe('12.34m²')
  })
})

describe('angle measurements', () => {
  test('measures angle around the vertex point', () => {
    expect(angleBetweenMeasurements([1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeCloseTo(Math.PI / 2)
  })

  test('formats angle measurements in degrees', () => {
    expect(formatAngleMeasurement(Math.PI / 2)).toBe('90°')
    expect(formatAngleMeasurement(Math.PI / 3)).toBe('60°')
  })

  test('formats angle measurements at selectable precision', () => {
    expect(formatAngleMeasurement(Math.PI / 7, { precision: 'coarse' })).toBe('26°')
    expect(formatAngleMeasurement(Math.PI / 7, { precision: 'standard' })).toBe('25.7°')
    expect(formatAngleMeasurement(Math.PI / 7, { precision: 'fine' })).toBe('25.71°')
  })

  test('returns a placeholder for non-finite angles', () => {
    expect(formatAngleMeasurement(NaN)).toBe('--')
  })
})
