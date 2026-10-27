import { expect, test } from 'bun:test'
import { GuideScaleReference } from '@pascal-app/core'
import { createGuideScaleReference, formatReferenceScaleLabel } from '../../lib/reference-scale'
import { formatFloorplanNumber, parseReferenceScaleLength } from './floorplan-panel'

test('floor-plan reference scales parse with the scoped locale', () => {
  expect(parseReferenceScaleLength('1,000', 'meters', 'fr')).toBe(1)
  expect(parseReferenceScaleLength('1,000', 'meters', 'en')).toBe(1000)
})

test('floor-plan reference scales display with the scoped locale', () => {
  expect(formatFloorplanNumber(2.75, 'fr')).toBe('2,75')
  expect(formatFloorplanNumber(2.75, 'en')).toBe('2.75')
})

test('reference-scale scenes store locale-neutral values and still display legacy labels', () => {
  const reference = createGuideScaleReference(
    {
      start: [0, 0],
      end: [1, 0],
      realLengthMeters: 2.75,
      measuredLengthUnits: 1,
      metersPerUnit: 2.75,
    },
    2.75,
    'meters',
  )

  expect(reference).toEqual({
    start: [0, 0],
    end: [1, 0],
    realLengthMeters: 2.75,
    measuredLengthUnits: 1,
    metersPerUnit: 2.75,
    displayLength: 2.75,
    displayUnit: 'meters',
  })
  expect(formatReferenceScaleLabel(reference, 'fr')).toBe('2,75 m')
  expect(formatReferenceScaleLabel(reference, 'en')).toBe('2.75 m')
  const legacyReference = GuideScaleReference.parse({
    start: [0, 0],
    end: [1, 0],
    realLengthMeters: 2.75,
    measuredLengthUnits: 1,
    metersPerUnit: 2.75,
    label: '2,75 m',
  })
  expect(formatReferenceScaleLabel(legacyReference, 'en')).toBe('2,75 m')
})
