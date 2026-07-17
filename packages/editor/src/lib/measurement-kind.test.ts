import { describe, expect, test } from 'bun:test'
import {
  CREATABLE_MEASUREMENT_KINDS,
  DEFAULT_CREATABLE_MEASUREMENT_KIND,
  normalizeCreatableMeasurementKind,
} from './measurement-kind'

describe('creatable measurement kinds', () => {
  test('keeps the supported creation kinds', () => {
    expect(CREATABLE_MEASUREMENT_KINDS).toEqual([
      'distance',
      'angle',
      'area',
      'perimeter',
      'volume',
    ])
    for (const kind of CREATABLE_MEASUREMENT_KINDS) {
      expect(normalizeCreatableMeasurementKind(kind)).toBe(kind)
    }
  })

  test.each([
    'smart',
    'unknown',
    null,
    undefined,
  ])('falls back from a non-creatable persisted value: %s', (value) => {
    expect(normalizeCreatableMeasurementKind(value)).toBe(DEFAULT_CREATABLE_MEASUREMENT_KIND)
  })
})
