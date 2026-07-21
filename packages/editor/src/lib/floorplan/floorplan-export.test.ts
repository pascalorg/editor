import { describe, expect, test } from 'bun:test'
import { DrawingSheetNode, type FloorplanGeometry } from '@pascal-app/core'
import {
  filterFloorplanExportOverlay,
  fitPlanToBox,
  placePlanAtDrawingScale,
  pointsPerMeterForDrawingScale,
  resolveGraphicScaleLength,
  resolveSheetComposition,
  resolveSheetExportLayout,
  resolveSheetPageSetup,
  resolveSheetPreflightIssues,
} from './floorplan-export'

describe('filterFloorplanExportOverlay', () => {
  test('preserves value labels and removes editing handles', () => {
    const label = {
      kind: 'dimension-label',
      appearance: 'outlined',
      cx: 1,
      cy: 0,
      text: '2.00m',
      angle: 0,
    } satisfies FloorplanGeometry
    const overlay = {
      kind: 'group',
      children: [
        label,
        {
          kind: 'endpoint-handle',
          point: [0, 0],
          state: 'idle',
          affordance: 'move-measurement-vertex',
          payload: { vertexIndex: 0 },
        },
      ],
    } satisfies FloorplanGeometry

    expect(filterFloorplanExportOverlay(overlay)).toEqual({
      kind: 'group',
      children: [label],
    })
  })
})

describe('fitPlanToBox', () => {
  test('preserves aspect ratio and centers the plan', () => {
    expect(fitPlanToBox(20, 10, 10, 20, 400, 300)).toEqual({
      x: 10,
      y: 70,
      width: 400,
      height: 200,
    })
  })
})

describe('pointsPerMeterForDrawingScale', () => {
  test('converts metric ratios to plotted points per metre', () => {
    expect(pointsPerMeterForDrawingScale('1:50')).toBeCloseTo(56.6929, 4)
  })

  test('converts imperial architectural scales to plotted points per metre', () => {
    expect(pointsPerMeterForDrawingScale('1/4"=1\'-0"')).toBeCloseTo(59.0551, 4)
  })
})

describe('placePlanAtDrawingScale', () => {
  test('centers the plan at the selected fixed scale', () => {
    expect(placePlanAtDrawingScale(10, 5, 10, 20, 800, 600, '1:100')).toEqual({
      x: 268.26771653543307,
      y: 249.13385826771653,
      width: 283.46456692913387,
      height: 141.73228346456693,
      clipped: false,
    })
  })

  test('keeps fixed scale when content is larger than the page box', () => {
    const placed = placePlanAtDrawingScale(30, 20, 10, 20, 400, 300, '1/4"=1\'-0"')

    expect(placed.width).toBeCloseTo(1771.65, 2)
    expect(placed.height).toBeCloseTo(1181.1, 2)
    expect(placed.clipped).toBe(true)
  })
})

describe('resolveSheetExportLayout', () => {
  test('reserves a plan viewport, side panel, and title block on one sheet page', () => {
    expect(resolveSheetExportLayout(842, 595)).toEqual({
      planBox: { x: 36, y: 36, width: 572, height: 463 },
      sidePanel: { x: 626, y: 36, width: 180, height: 463 },
      titleBlock: { x: 36, y: 517, width: 770, height: 42 },
    })
  })
})

describe('resolveGraphicScaleLength', () => {
  test('chooses a model length that fits the available paper width', () => {
    const scale = resolveGraphicScaleLength('1:50', 150)

    expect(scale.modelMeters).toBe(2)
    expect(scale.widthPt).toBeCloseTo(113.39, 2)
    expect(scale.label).toBe('2 m')
  })
})

describe('resolveSheetComposition', () => {
  test('uses drawing-sheet metadata for view titles, references, notes, and scale', () => {
    const sheet = DrawingSheetNode.parse({
      id: 'drawing-sheet_a101',
      sheetNumber: 'A1.1',
      sheetTitle: 'Plans',
      placedViews: [
        {
          id: 'drawing-view_main',
          levelId: 'level_main',
          drawingType: 'floor-plan',
          drawingNumber: '2',
          title: 'Main Floor Plan',
          scale: '1:50',
        },
      ],
      generalNotes: [{ id: 'sheet-note_1', number: 1, text: 'Verify all dimensions.' }],
      keyedNoteLegend: [{ key: 'A', text: 'Patch existing slab.' }],
    })

    expect(
      resolveSheetComposition(
        { [sheet.id]: sheet },
        'level_main',
        'Main Level',
        'floor-plan',
        'Floor plan',
        '1/4"=1\'-0"',
      ),
    ).toMatchObject({
      sheetNumber: 'A1.1',
      sheetTitle: 'Plans',
      paperSize: 'arch-b',
      orientation: 'landscape',
      drawingNumber: '2',
      viewTitle: 'Main Floor Plan',
      scale: '1:50',
      generalNotes: [{ number: 1, text: 'Verify all dimensions.' }],
      keyedNoteLegend: [{ key: 'A', text: 'Patch existing slab.' }],
    })
  })
})

describe('resolveSheetPageSetup', () => {
  test('resolves supported paper sizes and orientation to page points', () => {
    expect(
      resolveSheetPageSetup({
        paperSize: 'arch-b',
        orientation: 'landscape',
        customPaperWidth: null,
        customPaperHeight: null,
      }),
    ).toEqual({ width: 1296, height: 864, orientation: 'landscape' })

    const a3 = resolveSheetPageSetup({
      paperSize: 'a3',
      orientation: 'portrait',
      customPaperWidth: null,
      customPaperHeight: null,
    })
    expect(a3.width).toBeCloseTo(841.89, 2)
    expect(a3.height).toBeCloseTo(1190.55, 2)
  })

  test('uses custom paper dimensions in inches', () => {
    expect(
      resolveSheetPageSetup({
        paperSize: 'custom',
        orientation: 'portrait',
        customPaperWidth: 24,
        customPaperHeight: 36,
      }),
    ).toEqual({ width: 1728, height: 2592, orientation: 'portrait' })
  })
})

describe('resolveSheetPreflightIssues', () => {
  test('reports clipped scaled content as a sheet preflight warning', () => {
    expect(resolveSheetPreflightIssues({ clipped: true })).toEqual([
      {
        severity: 'warning',
        message:
          'Scaled plan exceeds the sheet viewport. Review clipped view or annotation content.',
      },
    ])
    expect(resolveSheetPreflightIssues({ clipped: false })).toEqual([])
  })
})
