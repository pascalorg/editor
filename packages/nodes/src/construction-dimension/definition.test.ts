import { describe, expect, test } from 'bun:test'
import { constructionDimensionDefinition } from './definition'

describe('constructionDimensionDefinition', () => {
  test('registers a selectable floor-plan construction annotation', () => {
    expect(constructionDimensionDefinition.kind).toBe('construction-dimension')
    expect(constructionDimensionDefinition.category).toBe('analysis')
    expect(constructionDimensionDefinition.bake).toBe('strip')
    expect(constructionDimensionDefinition.schemaVersion).toBe(7)
    expect(constructionDimensionDefinition.dirtyTracking).toBe(false)
    expect(constructionDimensionDefinition.capabilities).toMatchObject({
      selectable: { hitVolume: 'bbox' },
      deletable: true,
      duplicable: true,
      presettable: false,
    })
    expect(constructionDimensionDefinition.floorplanAffordances).toHaveProperty(
      'move-construction-dimension-baseline',
    )
    expect(constructionDimensionDefinition.floorplanAffordances).toHaveProperty(
      'move-construction-dimension-witness',
    )
  })

  test('produces schema-valid defaults', () => {
    expect(
      constructionDimensionDefinition.schema.safeParse({
        id: 'construction-dimension_default',
        type: 'construction-dimension',
        ...constructionDimensionDefinition.defaults(),
      }).success,
    ).toBe(true)
  })
})
