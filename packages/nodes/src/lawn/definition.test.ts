import { expect, test } from 'bun:test'
import { LawnNode } from '@pascal-app/core'
import { lawnRenderDefinition } from './definition.render'

test('a lawn is a Site-owned selectable ground surface with read-only plan and portable export', () => {
  const definition = lawnRenderDefinition
  expect(definition.capabilities.hostable?.parents).toEqual(['site'])
  expect(definition.capabilities.exterior).toBe(true)
  expect(definition.floorplanScope).toBe('site')
  expect(definition.sitePlan).toBe(true)
  expect(definition.bake).toBe('replace')
  expect(typeof definition.geometry).toBe('function')
  expect(typeof definition.bakeGeometry).toBe('function')
  expect(typeof definition.bakeReplaceRenderer?.module).toBe('function')
  const defaults = LawnNode.parse({ ...definition.defaults(), id: 'lawn_defaults', type: 'lawn' })
  expect(defaults.height).toBe(0.06)
  expect(defaults.flowers).toEqual([])
  expect(defaults.flowerDensity).toBe(0)
  expect(defaults.strokes).toEqual([])
  expect(defaults.gen).toBe(1)
})
