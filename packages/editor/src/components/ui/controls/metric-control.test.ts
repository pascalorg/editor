import { expect, test } from 'bun:test'
import { formatMetricInputValue, parseMetricInput } from './metric-control'

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
