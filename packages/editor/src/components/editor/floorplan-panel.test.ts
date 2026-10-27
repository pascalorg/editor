import { expect, test } from 'bun:test'
import { GuideScaleReference } from '@pascal-app/core'
import { z } from 'zod'
import { createGuideScaleReference, formatReferenceScaleLabel } from '../../lib/reference-scale'
import { formatFloorplanNumber, parseReferenceScaleLength } from './floorplan-panel'

const Core106GuideScaleReference = z.object({
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  realLengthMeters: z.number().positive(),
  measuredLengthUnits: z.number().positive(),
  metersPerUnit: z.number().positive(),
  label: z.string(),
})

test('floor-plan reference scales parse with the scoped locale', () => {
  expect(parseReferenceScaleLength('1,000', 'meters', 'fr')).toBe(1)
  expect(parseReferenceScaleLength('1,000', 'meters', 'en')).toBe(1000)
})

test('floor-plan reference scales display with the scoped locale', () => {
  expect(formatFloorplanNumber(2.75, 'fr')).toBe('2,75')
  expect(formatFloorplanNumber(2.75, 'en')).toBe('2.75')
})

test('reference-scale scenes remain compatible and format numeric and legacy labels', () => {
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
    label: '2.75 m',
  })
  expect(Core106GuideScaleReference.safeParse(reference).success).toBe(true)
  expect(formatReferenceScaleLabel(reference, 'fr')).toBe('2,75 m')
  expect(formatReferenceScaleLabel(reference, 'en')).toBe('2.75 m')
  const legacyFrenchReference = GuideScaleReference.parse({
    start: [0, 0],
    end: [1, 0],
    realLengthMeters: 2.75,
    measuredLengthUnits: 1,
    metersPerUnit: 2.75,
    label: '2,75 m',
  })
  expect(formatReferenceScaleLabel(legacyFrenchReference, 'en')).toBe('2.75 m')
  expect(
    formatReferenceScaleLabel(
      GuideScaleReference.parse({
        ...legacyFrenchReference,
        label: '2.75 m',
      }),
      'fr',
    ),
  ).toBe('2,75 m')
  expect(
    formatReferenceScaleLabel(
      GuideScaleReference.parse({
        ...legacyFrenchReference,
        label: 'Known span',
      }),
      'fr',
    ),
  ).toBe('Known span')
})
