import { describe, expect, test } from 'bun:test'
import { getFloorplanNodeExtension } from '@pascal-app/editor'
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

  test('contributes drawing-sheet matching through the editor extension', () => {
    const sheet = drawingSheetDefinition.schema.parse({
      id: 'drawing-sheet_a101',
      placedViews: [
        {
          id: 'drawing-view_floor',
          levelId: 'level_main',
          drawingType: 'floor-plan',
          drawingNumber: '1',
          title: 'Main floor',
          scale: '1:50',
        },
      ],
    })
    const resolveDrawingSheet =
      getFloorplanNodeExtension(drawingSheetDefinition)?.resolveDrawingSheet

    expect(
      resolveDrawingSheet?.({ node: sheet, levelId: 'level_main', drawingType: 'floor-plan' }),
    ).toBe(sheet)
    expect(
      resolveDrawingSheet?.({ node: sheet, levelId: 'level_upper', drawingType: 'floor-plan' }),
    ).toBeNull()
  })
})
