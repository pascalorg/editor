import { expect, test } from 'bun:test'
import {
  getSegmentFasciaMaterial,
  hasSegmentMaterialOverride,
  RoofSegmentNode,
} from './roof-segment'

// Hawkesbury's flat roofs wear a black edge band; a fascia was a fixed 1x8 in the wall finish.
test('a fascia takes a height, a depth and its own finish', () => {
  const segment = RoofSegmentNode.parse({
    roofType: 'flat',
    fascia: true,
    fasciaHeight: 0.3,
    fasciaDepth: 0.03,
    fasciaMaterialPreset: 'library:preset-black',
  })
  expect(segment.fasciaHeight).toBe(0.3)
  expect(getSegmentFasciaMaterial(segment)).toEqual({
    material: undefined,
    materialPreset: 'library:preset-black',
  })
  expect(hasSegmentMaterialOverride(segment)).toBe(true)
})

test('without its own finish the fascia takes the wall finish, as before', () => {
  const segment = RoofSegmentNode.parse({ roofType: 'flat', fascia: true })
  expect(getSegmentFasciaMaterial(segment)).toBeNull()
  expect(hasSegmentMaterialOverride(segment)).toBe(false)
})
