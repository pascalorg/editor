import { expect, test } from 'bun:test'
import { withOpacity } from './css-color'

test('withOpacity keeps opaque colors unchanged', () => {
  expect(withOpacity('#111827', 1)).toBe('#111827')
})

test('withOpacity converts hex colors to rgba', () => {
  expect(withOpacity('#111827', 0.35)).toBe('rgba(17, 24, 39, 0.35)')
  expect(withOpacity('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)')
})
