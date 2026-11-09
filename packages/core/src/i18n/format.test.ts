import { expect, test } from 'bun:test'
import { formatFixed, formatList } from './format'

test('English lists keep the plain comma list; other locales use their own separators', () => {
  expect(formatList(['Kitchen', 'Hall'], 'en')).toBe('Kitchen, Hall')
  expect(formatList(['Kitchen', 'Hall', 'Bath'])).toBe('Kitchen, Hall, Bath')
  expect(formatList(['Kitchen', 'Hall', 'Bath'], 'en-GB')).toBe('Kitchen, Hall, Bath')
  expect(formatList(['Kitchen', 'Hall', 'Bath'], 'fr')).toBe('Kitchen, Hall et Bath')
  expect(formatList(['Kitchen', 'Hall', 'Bath'], 'ja')).toBe('Kitchen、Hall、Bath')
})

test('formatFixed rounds like toFixed, then writes the locale notation without -0', () => {
  for (const [value, digits] of [
    [2.55, 1],
    [1.005, 2],
    [0.125, 2],
    [12.345, 1],
    [1234.5, 1],
  ] as const) {
    expect(formatFixed(value, digits, 'en')).toBe(value.toFixed(digits))
  }
  expect(formatFixed(2.55, 1, 'fr')).toBe('2,5')
  expect(formatFixed(1234.5, 1, 'fr')).toBe('1234,5')
  expect(formatFixed(-0.001, 2, 'en')).toBe('0.00')
  expect(formatFixed(-0, 1, 'fr')).toBe('0,0')
})
