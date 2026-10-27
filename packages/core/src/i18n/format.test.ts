import { expect, test } from 'bun:test'
import { formatList } from './format'

test('English lists keep the plain comma list; other locales use their own separators', () => {
  expect(formatList(['Kitchen', 'Hall'], 'en')).toBe('Kitchen, Hall')
  expect(formatList(['Kitchen', 'Hall', 'Bath'])).toBe('Kitchen, Hall, Bath')
  expect(formatList(['Kitchen', 'Hall', 'Bath'], 'en-GB')).toBe('Kitchen, Hall, Bath')
  expect(formatList(['Kitchen', 'Hall', 'Bath'], 'fr')).toBe('Kitchen, Hall et Bath')
  expect(formatList(['Kitchen', 'Hall', 'Bath'], 'ja')).toBe('Kitchen、Hall、Bath')
})
