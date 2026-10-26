import { expect, test } from 'bun:test'
import { parseReferenceScaleLength } from './floorplan-panel'

test('floor-plan reference scales parse with the scoped locale', () => {
  expect(parseReferenceScaleLength('2,75', 'meters', 'fr')).toBe(2.75)
  expect(parseReferenceScaleLength('2,75', 'meters', 'en')).toBeNull()
})
