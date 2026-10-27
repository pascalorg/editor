import { expect, test } from 'bun:test'
import {
  formatMetricInputValue,
  parseMetricInput,
  roundMetricValueForDisplay,
} from './metric-control'

test('metric controls parse stair dimensions with the scoped locale', () => {
  expect(
    parseMetricInput('1,000', 'm', {
      isImperial: false,
      locale: 'fr',
      parseUnit: 'm',
    }),
  ).toBe(1)
  expect(
    parseMetricInput('1,000', 'm', {
      isImperial: false,
      locale: 'en',
      parseUnit: 'm',
    }),
  ).toBe(1000)
})

test('metric controls write values back with the scoped decimal separator', () => {
  expect(formatMetricInputValue(2.75, 2, 'fr')).toBe('2,75')
  expect(formatMetricInputValue(2.75, 2, 'en')).toBe('2.75')
})

test('metric write-back rounds negative halves away from zero like the display', () => {
  expect(roundMetricValueForDisplay(-1.25, 1)).toBe(-1.3)
  expect(formatMetricInputValue(-1.25, 1, 'en')).toBe('-1.3')
  expect(roundMetricValueForDisplay(1.25, 1)).toBe(1.3)
  expect(formatMetricInputValue(1.25, 1, 'en')).toBe('1.3')
})

test('metric write-back and display agree for values immediately below a half', () => {
  const positive = 1.2499999999999998
  const negative = -positive

  expect(roundMetricValueForDisplay(negative, 1)).toBe(-1.2)
  expect(formatMetricInputValue(negative, 1, 'en')).toBe('-1.2')
  expect(roundMetricValueForDisplay(positive, 1)).toBe(1.2)
  expect(formatMetricInputValue(positive, 1, 'en')).toBe('1.2')
})

test('metric write-back preserves Intl rounding for binary-inexact decimal halves', () => {
  expect(roundMetricValueForDisplay(-1.005, 2)).toBe(-1.01)
  expect(formatMetricInputValue(-1.005, 2, 'en')).toBe('-1.01')
  expect(roundMetricValueForDisplay(1.005, 2)).toBe(1.01)
  expect(formatMetricInputValue(1.005, 2, 'en')).toBe('1.01')
})
