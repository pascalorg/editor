import { expect, test } from 'bun:test'
import { parseCabinetDimensionInput } from '../dimension-input'

test('cabinet dimension input follows the scoped locale', () => {
  expect(
    parseCabinetDimensionInput('1,000', {
      locale: 'fr',
      metricNotation: 'meters',
      unit: 'metric',
    }),
  ).toBe(1)
  expect(
    parseCabinetDimensionInput('1,000', {
      locale: 'en',
      metricNotation: 'meters',
      unit: 'metric',
    }),
  ).toBe(1000)
})
