import { expect, test } from 'bun:test'
import type { GeometryScriptParamSpec } from '@pascal-app/core'
import { isScriptDefault, scriptDefault, scriptDefaultsPatch } from './script-param-defaults'

const specs: GeometryScriptParamSpec[] = [
  { id: 'shelves', kind: 'number', default: 4, min: 2, max: 8, step: 1 },
  { id: 'width', kind: 'number', default: 0.9, min: 0.4, max: 2, step: 0.01, unit: 'm' },
  { id: 'back', kind: 'boolean', default: true },
  { id: 'finish', kind: 'string', default: 'oak', options: ['oak', 'walnut'] },
]

test('only the params changed from their script default are reset, to that default', () => {
  const params = { shelves: 6, width: 0.9, back: false, finish: 'oak' }
  expect(scriptDefaultsPatch(specs, params)).toEqual({ shelves: 4, back: true })
})

test('params at their defaults leave nothing to reset', () => {
  expect(scriptDefaultsPatch(specs, { shelves: 4, width: 0.9, back: true, finish: 'oak' })).toEqual(
    {},
  )
  expect(scriptDefaultsPatch(specs, {})).toEqual({})
})

test('a slider value off by float noise still counts as the default', () => {
  expect(isScriptDefault(specs[1]!, 0.1 + 0.8)).toBe(true)
  expect(isScriptDefault(specs[1]!, 0.91)).toBe(false)
})

test('a default declared outside its range resets to the clamped value the compile keeps', () => {
  const spec: GeometryScriptParamSpec = { id: 'depth', kind: 'number', default: 5, max: 3 }
  expect(scriptDefault(spec)).toBe(3)
  expect(isScriptDefault(spec, 3)).toBe(true)
  expect(scriptDefaultsPatch([spec], { depth: 2 })).toEqual({ depth: 3 })
})

test('a default below a minimum with no maximum resets to that minimum', () => {
  const spec: GeometryScriptParamSpec = { id: 'height', kind: 'number', default: 1, min: 2 }
  expect(scriptDefault(spec)).toBe(2)
  expect(isScriptDefault(spec, 2)).toBe(true)
  expect(scriptDefaultsPatch([spec], { height: 3 })).toEqual({ height: 2 })
})

test('step is a control hint: fractional defaults are not rounded', () => {
  const spec: GeometryScriptParamSpec = { id: 'count', kind: 'number', default: 2.5, step: 1 }
  expect(scriptDefault(spec)).toBe(2.5)
  expect(scriptDefaultsPatch([spec], { count: 3 })).toEqual({ count: 2.5 })
})

test('string options compare by value and free text and booleans reset to declared defaults', () => {
  const text: GeometryScriptParamSpec = { id: 'title', kind: 'string', default: 'Books' }
  expect(
    scriptDefaultsPatch([...specs, text], { finish: 'walnut', back: false, title: 'Other' }),
  ).toEqual({ finish: 'oak', back: true, title: 'Books' })
  expect(isScriptDefault(specs[3]!, 'Oak')).toBe(false)
})

test('a value for a param the script no longer declares is left alone', () => {
  expect(scriptDefaultsPatch(specs, { shelves: 4, removed: 12 })).toEqual({})
})
