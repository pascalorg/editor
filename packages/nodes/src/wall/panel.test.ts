import { expect, test } from 'bun:test'
import { createI18n, FRAMING_SPACINGS } from '@pascal-app/core'
import { formatSpacing } from '../shared/build-up-controls'
import { studSpacingChoices } from './panel'

const INCH = 0.0254

// Walls offered 12/16/24 "in on centre" while roofs and ceilings offered 12/16/19.2/24 `" o.c.`.
test('wall studs offer the framing spacings roofs and ceilings do, keeping one off the list', () => {
  expect(studSpacingChoices(undefined)).toEqual({ sizes: FRAMING_SPACINGS, current: null })
  expect(studSpacingChoices(16 * INCH + 1e-9).current).toBe(FRAMING_SPACINGS[1])
  expect(studSpacingChoices(0.6)).toEqual({ sizes: [0.6, ...FRAMING_SPACINGS], current: 0.6 })
  const english = createI18n()
  expect(FRAMING_SPACINGS.map((size) => formatSpacing(size, 'imperial', english))).toEqual([
    '12" o.c.',
    '16" o.c.',
    '19.2" o.c.',
    '24" o.c.',
  ])
})
