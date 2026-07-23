import { describe, expect, test } from 'bun:test'
import { buildingDefinition } from './definition'

describe('buildingDefinition', () => {
  test('tracks drawing-sheet child support in the schema version', () => {
    expect(buildingDefinition.kind).toBe('building')
    expect(buildingDefinition.schemaVersion).toBe(2)
    expect(
      buildingDefinition.schema.safeParse({
        id: 'building_default',
        type: 'building',
        ...buildingDefinition.defaults(),
        children: ['level_main', 'drawing-sheet_a101'],
      }).success,
    ).toBe(true)
  })
})
