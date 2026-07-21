import { describe, expect, test } from 'bun:test'
import { migrateConstructionDimensionV6ToV7 } from './migration'

describe('migrateConstructionDimensionV6ToV7', () => {
  test('removes reference notation and shows legacy reference drawing copies normally', () => {
    expect(
      migrateConstructionDimensionV6ToV7({
        type: 'construction-dimension',
        reference: true,
        referenceStyle: 'suffix',
        drawingOverrides: [{ drawingType: 'roof-plan', presentation: 'reference' }],
      }),
    ).toEqual({
      type: 'construction-dimension',
      drawingOverrides: [{ drawingType: 'roof-plan', presentation: 'shown' }],
    })
  })
})
