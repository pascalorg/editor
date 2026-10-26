import { expect, test } from 'bun:test'
import { parseCabinetDimensionInput } from '../dimension-input'

test('cabinet dimension input follows the scoped locale', () => {
  expect(
    parseCabinetDimensionInput('0,75', {
      locale: 'fr',
      metricNotation: 'meters',
      unit: 'metric',
    }),
  ).toBe(0.75)
  expect(
    parseCabinetDimensionInput('0,75', {
      locale: 'en',
      metricNotation: 'meters',
      unit: 'metric',
    }),
  ).toBeNull()
})
