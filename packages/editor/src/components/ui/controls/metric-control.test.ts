import { expect, test } from 'bun:test'
import { parseMetricInput } from './metric-control'

test('metric controls parse stair dimensions with the scoped locale', () => {
  expect(
    parseMetricInput('1,5', 'm', {
      isImperial: false,
      locale: 'fr',
      parseUnit: 'm',
    }),
  ).toBe(1.5)
  expect(
    parseMetricInput('1,5', 'm', {
      isImperial: false,
      locale: 'en',
      parseUnit: 'm',
    }),
  ).toBeNull()
})
