import { expect, test } from 'bun:test'
import { safeNextPath } from './safe-next-path'

const ORIGIN = 'https://pascal.example'

test('same-origin paths are kept, including query and hash', () => {
  expect(safeNextPath('/', ORIGIN)).toBe('/')
  expect(safeNextPath('/scenes/abc', ORIGIN)).toBe('/scenes/abc')
  expect(safeNextPath('/scenes?tab=mine#top', ORIGIN)).toBe('/scenes?tab=mine#top')
  expect(safeNextPath('/a/../b', ORIGIN)).toBe('/b')
})

test('a missing or non-path value falls back to the root', () => {
  expect(safeNextPath(undefined, ORIGIN)).toBe('/')
  expect(safeNextPath('', ORIGIN)).toBe('/')
  expect(safeNextPath('scenes', ORIGIN)).toBe('/')
  expect(safeNextPath('https://evil.example/', ORIGIN)).toBe('/')
  expect(safeNextPath('javascript:alert(1)', ORIGIN)).toBe('/')
})

test('values that resolve to another origin fall back to the root', () => {
  for (const next of [
    '//evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '\\\\evil.example',
  ]) {
    expect([next, safeNextPath(next, ORIGIN)]).toEqual([next, '/'])
  }
})

test('a path that normalises to a protocol-relative form falls back to the root', () => {
  expect(safeNextPath('/.//evil.example', ORIGIN)).toBe('/')
  expect(safeNextPath('/x/..//evil.example', ORIGIN)).toBe('/')
})

test('an unparseable origin falls back to the root', () => {
  expect(safeNextPath('/scenes', 'not an origin')).toBe('/')
})
