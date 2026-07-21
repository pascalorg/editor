import { describe, expect, test } from 'bun:test'
import { drawingSheetDefinition } from './definition'

describe('drawingSheetDefinition', () => {
  test('registers persistent drawing sheets as non-geometric document nodes', () => {
    expect(drawingSheetDefinition.kind).toBe('drawing-sheet')
    expect(drawingSheetDefinition.bake).toBe('strip')
    expect(drawingSheetDefinition.schemaVersion).toBe(4)
    expect(drawingSheetDefinition.dirtyTracking).toBe(false)
    expect(drawingSheetDefinition.capabilities).toMatchObject({
      deletable: true,
      duplicable: true,
      presettable: false,
    })
  })

  test('produces schema-valid defaults', () => {
    expect(
      drawingSheetDefinition.schema.safeParse({
        id: 'drawing-sheet_default',
        type: 'drawing-sheet',
        ...drawingSheetDefinition.defaults(),
      }).success,
    ).toBe(true)
  })
})
