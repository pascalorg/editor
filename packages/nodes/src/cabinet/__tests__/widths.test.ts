import { expect, test } from 'bun:test'
import {
  CABINET_STANDARD_WIDTHS,
  cabinetStandardWidthById,
  cabinetStandardWidthId,
} from '../widths'

test('recognizes standard metric module widths', () => {
  expect(cabinetStandardWidthId(0.6)).toBe('600')
  expect(cabinetStandardWidthId(0.80000001)).toBe('800')
})

test('keeps non-catalog widths custom', () => {
  expect(cabinetStandardWidthId(0.55)).toBe('custom')
})

test('returns the selected standard width value', () => {
  expect(cabinetStandardWidthById('600')).toEqual(
    CABINET_STANDARD_WIDTHS.find((option) => option.id === '600'),
  )
})
