import { expect, test } from 'bun:test'
import { ROOF_BUILD_UP_PRESETS, roofBuildUpDepths } from '@pascal-app/core'
import { formatLayerDepth, formatLayerThickness } from './layer-thickness'

const IN = 0.0254

// The roof layers read DECK 10-3/16" beside COVERING 0.54": a covering of shingle and underlayment
// is no exact 32nd, so it fell to decimals. Summed depths read as fractions, to the nearest 1/16".
test('summed depths read as fractions to the 1/16", like the deck beside them', () => {
  expect(formatLayerDepth(0.54 * IN, 'imperial')).toBe('9/16"')
  for (const preset of ROOF_BUILD_UP_PRESETS) {
    const { deck, covering } = roofBuildUpDepths(preset.buildUp)
    for (const depth of [deck, covering])
      expect(formatLayerDepth(depth, 'imperial')).toMatch(/^(\d+|\d+\/\d+|\d+-\d+\/\d+)"$/)
  }
  expect(formatLayerDepth(0.0137, 'metric')).toBe('13.7 mm')
})

test('a typed thickness still reads back as typed', () => {
  expect(formatLayerThickness((7 / 16) * IN, 'imperial')).toBe('7/16"')
  expect(formatLayerThickness(0.0111, 'imperial')).toBe('0.437"')
})
