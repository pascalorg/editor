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
  const rounded = roundMetricValueForDisplay(-1.25, 1)

  expect(rounded).toBe(-1.3)
  expect(formatMetricInputValue(rounded, 1, 'en')).toBe('-1.3')
  expect(roundMetricValueForDisplay(1.25, 1)).toBe(1.3)
})
