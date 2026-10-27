import { expect, test } from 'bun:test'
import { formatFloorplanNumber, parseReferenceScaleLength } from './floorplan-panel'

test('floor-plan reference scales parse with the scoped locale', () => {
  expect(parseReferenceScaleLength('1,000', 'meters', 'fr')).toBe(1)
  expect(parseReferenceScaleLength('1,000', 'meters', 'en')).toBe(1000)
})

test('floor-plan reference scales display with the scoped locale', () => {
  expect(formatFloorplanNumber(2.75, 'fr')).toBe('2,75')
  expect(formatFloorplanNumber(2.75, 'en')).toBe('2.75')
})
