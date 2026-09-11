import { expect, test } from 'bun:test'
import { RoofNode } from './roof'

test('roofs default to custom level support', () => {
  expect(RoofNode.parse({}).support).toEqual({ kind: 'level' })
})

test('wall-follow support survives JSON parsing without host references', () => {
  const roof = RoofNode.parse({ support: { kind: 'walls' }, position: [2, -0.5, 1] })
  expect(RoofNode.parse(JSON.parse(JSON.stringify(roof)))).toEqual(roof)
})
