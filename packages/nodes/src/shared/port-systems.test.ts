import { expect, test } from 'bun:test'
import { runSectionHalfSizeM } from './port-systems'

test('places a run centerline half its section above the support plane', () => {
  expect(runSectionHalfSizeM(2)).toBeCloseTo(0.0254)
  expect(runSectionHalfSizeM(8)).toBeCloseTo(0.1016)
})
