import { beforeAll, describe, expect, test } from 'bun:test'
import {
  DrawingSheetNode,
  type FloorplanGeometry,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { splitFloorplanOverlay } from '../../components/editor-2d/renderers/floorplan-registry-layer'
import {
  filterFloorplanExportOverlay,
  fitPlanToBox,
  isFloorplanExportAnnotationGeometry,
  partitionFloorplanExportOverlay,
  pointsPerMeterForDrawingScale,
  resolveDrawingSheetDocumentMarkers,
  resolveDrawingSheetGeneralNotes,
  resolveDrawingSheetKeyedNotes,
  resolveFloorplanExportAnnotationVisibility,
  resolveFloorplanExportNodeGeometry,
  resolveFloorplanExportPlacement,
  resolveFloorplanExportRotationDeg,
  resolveFloorplanExportViewport,
  resolveFloorplanExportViewState,
  resolveFloorplanMeasurementSize,
  resolveFloorplanPageLayout,
  resolveFloorplanScreenUnitsPerPixel,
  resolveGraphicScaleLength,
  resolveSheetComposition,
  resolveSheetExportLayout,
  resolveSheetPageSetup,
  rotateFloorplanExportBounds,
} from './floorplan-export'
import { type FloorplanNodeExtension, floorplanGeometryMetadata } from './floorplan-extension'

const drawingSheetExtension: FloorplanNodeExtension<DrawingSheetNode> = {
  resolveDrawingSheet: ({ node, levelId, drawingType }) =>
    node.placedViews.some(
      (view) =>
        (view.levelId === null || view.levelId === levelId) && view.drawingType === drawingType,
    )
      ? node
      : null,
}

beforeAll(() => {
  if (nodeRegistry.has('drawing-sheet')) return
  registerNode({
    kind: 'drawing-sheet',
    schemaVersion: 1,
    schema: DrawingSheetNode,
    category: 'analysis',
    defaults: () => ({}) as never,
    capabilities: {},
    extensions: {
      'pascal:editor/floorplan': drawingSheetExtension,
    },
  })
})

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

  test('preserves wall, door, and window shapes used as annotation obstacles', () => {
    const fixedGeometry = {
      kind: 'group',
      children: [
        {
          kind: 'polygon',
          points: [
            [0, 0],
            [4, 0],
            [4, 0.2],
            [0, 0.2],
          ],
          fill: '#374151',
          stroke: '#1f2937',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
        },
        {
          kind: 'path',
          d: 'M 1 0 A 1 1 0 0 1 2 1',
          fill: 'none',
          stroke: '#64748b',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
        },
        {
          kind: 'line',
          x1: 2.5,
          y1: 0,
          x2: 3.5,
          y2: 0,
          stroke: '#1f2937',
          metadata: floorplanGeometryMetadata({ annotationObstacle: 'bounds' }),
        },
        { kind: 'move-handle', point: [2, 0.1] },
      ],
    } satisfies FloorplanGeometry

    const { overlay } = splitFloorplanOverlay(fixedGeometry)
    expect(overlay).not.toBeNull()
    expect(filterFloorplanExportOverlay(overlay!)).toEqual({
      kind: 'group',
      children: fixedGeometry.children.slice(0, 3),
      transform: undefined,
    })
  })

  test('keeps structural obstacles in model bounds while leaving marks as annotations', () => {
    const wall = {
      kind: 'polygon',
      points: [
        [0, 0],
        [4, 0],
        [4, 0.2],
        [0, 0.2],
      ],
      fill: '#374151',
      metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
    } satisfies FloorplanGeometry
    const openingMark = {
      kind: 'group',
      metadata: floorplanGeometryMetadata({ annotationRole: 'opening-mark' }),
      children: [
        {
          kind: 'rect',
          x: 1,
          y: 1,
          width: 0.4,
          height: 0.2,
          fill: '#ffffff',
          stroke: '#334155',
        },
        { kind: 'text', x: 1.2, y: 1.1, text: 'W01', fontSize: 0.1, upright: true },
      ],
    } satisfies FloorplanGeometry

    expect(
      partitionFloorplanExportOverlay({ kind: 'group', children: [wall, openingMark] }),
    ).toEqual({
      model: { kind: 'group', children: [wall], transform: undefined },
      annotations: { kind: 'group', children: [openingMark], transform: undefined },
    })
  })

  test('moves automatic dimensions embedded in base wall geometry into the PDF annotation layer', () => {
    const wall = {
      kind: 'polygon',
      points: [
        [0, 0],
        [4, 0],
        [4, 0.2],
        [0, 0.2],
      ],
      fill: '#374151',
    } satisfies FloorplanGeometry
    const dimensions = {
      kind: 'dimension-string',
      segments: [{ start: [0, 0], end: [4, 0], text: '4m' }],
      offsetNormal: [0, -1],
      offsetDistance: 1,
      extensionOvershoot: 0.12,
    } satisfies FloorplanGeometry

    expect(
      resolveFloorplanExportNodeGeometry(
        { kind: 'group', children: [wall, dimensions] },
        null,
        false,
      ),
    ).toEqual({
      model: { kind: 'group', children: [wall], transform: undefined },
      annotations: { kind: 'group', children: [dimensions], transform: undefined },
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

describe('floor plan export policy', () => {
  test('uses the live floor-plan formatting profile for metric and imperial dimensions', () => {
    expect(resolveFloorplanExportViewState('metric', 'millimeters')).toMatchObject({
      purpose: 'edit',
      unit: 'metric',
      metricNotation: 'millimeters',
    })
    expect(resolveFloorplanExportViewState('imperial', 'meters')).toMatchObject({
      purpose: 'edit',
      unit: 'imperial',
      metricNotation: 'meters',
    })
  })

  test('fits an oversized plan inside the complete export viewport', () => {
    const placement = resolveFloorplanExportPlacement(30, 20, 10, 20, 400, 300)

    expect(placement.x).toBe(10)
    expect(placement.y).toBeCloseTo(36.67, 2)
    expect(placement.width).toBe(400)
    expect(placement.height).toBeCloseTo(266.67, 2)
    expect(placement.x).toBeGreaterThanOrEqual(10)
    expect(placement.y).toBeGreaterThanOrEqual(20)
    expect(placement.x + placement.width).toBeLessThanOrEqual(410)
    expect(placement.y + placement.height).toBeLessThanOrEqual(320)
  })

  test('exports the same annotation categories that are visible in the live view', () => {
    const liveVisibility = {
      automaticDimensions: true,
      manualDimensions: false,
      measurements: true,
      openingMarks: true,
      structuralGrids: false,
      roomLabels: false,
      stairAnnotations: true,
    }

    expect(resolveFloorplanExportAnnotationVisibility(liveVisibility)).toEqual(liveVisibility)
  })

  test('matches live screen sizing to the fitted export viewport', () => {
    expect(resolveFloorplanScreenUnitsPerPixel(7, 4.5, 572, 463)).toBeCloseTo(0.012_237_762, 8)
  })

  test('keeps the export viewport anchored to the structural drawing bounds', () => {
    expect(resolveFloorplanExportViewport({ x: -5, y: -6, width: 13, height: 13.5 })).toEqual({
      x: -7.7,
      y: -8.7,
      width: 18.4,
      height: 18.9,
    })
  })

  test('fits the viewport around the rotated plan instead of clipping its corners', () => {
    const bounds = rotateFloorplanExportBounds({ x: 0, y: 0, width: 10, height: 5 }, 90)

    expect(bounds.x).toBeCloseTo(-5, 8)
    expect(bounds.y).toBeCloseTo(0, 8)
    expect(bounds.width).toBeCloseTo(5, 8)
    expect(bounds.height).toBeCloseTo(10, 8)
  })

  test('keeps annotation-only nodes out of primary model bounds', () => {
    expect(
      isFloorplanExportAnnotationGeometry({
        kind: 'group',
        children: [],
        metadata: { 'pascal:editor/floorplan': { annotationRole: 'measurement' } },
      }),
    ).toBe(true)
    expect(
      isFloorplanExportAnnotationGeometry({
        kind: 'group',
        children: [],
        metadata: { 'pascal:editor/floorplan': { annotationRole: 'manual-dimension' } },
      }),
    ).toBe(true)
    expect(isFloorplanExportAnnotationGeometry({ kind: 'polygon', points: [] })).toBe(false)
  })

  test('matches the current floor-plan rotation instead of forcing north-up', () => {
    expect(resolveFloorplanExportRotationDeg(Math.PI / 6, Math.PI / 2)).toBeCloseTo(60, 8)
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

describe('resolveFloorplanMeasurementSize', () => {
  test('sizes the hidden SVG in screen pixels before resolving label collisions', () => {
    expect(
      resolveFloorplanMeasurementSize({ x: -2, y: -3, width: 18.4, height: 18.9 }, 0.024),
    ).toEqual({ width: 18.4 / 0.024, height: 18.9 / 0.024 })
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

describe('resolveFloorplanPageLayout', () => {
  test('uses the page for the plan without drawing-sheet sidebars or title blocks', () => {
    expect(resolveFloorplanPageLayout(842, 595)).toEqual({
      planBox: { x: 36, y: 64, width: 770, height: 495 },
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
      keyedNoteInstances: [],
    })
  })

  test('resolves reusable general note sets before sheet-local notes', () => {
    const sheet = DrawingSheetNode.parse({
      id: 'drawing-sheet_a101',
      generalNoteSetIds: ['sheet-note-set_project'],
      generalNoteSets: [
        {
          id: 'sheet-note-set_project',
          name: 'Project Notes',
          notes: [{ id: 'sheet-note_project-1', number: 7, text: 'Coordinate with structural.' }],
        },
      ],
      generalNotes: [{ id: 'sheet-note_sheet-1', number: 99, text: 'Verify dimensions.' }],
    })

    expect(resolveDrawingSheetGeneralNotes(sheet).notes).toEqual([
      { number: 1, text: 'Coordinate with structural.' },
      { number: 2, text: 'Verify dimensions.' },
    ])
  })

  test('reports duplicate reusable and sheet-local general notes', () => {
    const sheet = DrawingSheetNode.parse({
      id: 'drawing-sheet_a101',
      generalNoteSets: [
        {
          id: 'sheet-note-set_project',
          name: 'Project Notes',
          notes: [{ id: 'sheet-note_project-1', number: 1, text: 'Verify all dimensions.' }],
        },
      ],
      generalNotes: [{ id: 'sheet-note_sheet-1', number: 1, text: 'VERIFY  ALL DIMENSIONS.' }],
    })

    expect(resolveDrawingSheetGeneralNotes(sheet).duplicateWarnings).toEqual([
      {
        severity: 'warning',
        message:
          'Duplicate general note: "Verify all dimensions." appears in Project Notes and sheet.',
      },
    ])
  })

  test('derives keyed-note legends from repeated stable instances', () => {
    const sheet = DrawingSheetNode.parse({
      id: 'drawing-sheet_a101',
      placedViews: [{ id: 'drawing-view_main', levelId: 'level_main' }],
      keyedNoteDefinitions: [
        { id: 'keyed-note_patch', key: 'A', text: 'Patch existing slab.' },
        { id: 'keyed-note_verify', key: 'B', text: 'Verify bearing.' },
      ],
      keyedNoteInstances: [
        {
          id: 'keyed-note-instance_patch-1',
          definitionId: 'keyed-note_patch',
          placedViewId: 'drawing-view_main',
          position: [2, 3],
        },
        {
          id: 'keyed-note-instance_patch-2',
          definitionId: 'keyed-note_patch',
          placedViewId: 'drawing-view_main',
          position: [4, 3],
        },
      ],
      keyedNoteLegend: [{ key: 'Z', text: 'Legacy unused note.' }],
    })

    expect(resolveDrawingSheetKeyedNotes(sheet, 'drawing-view_main')).toEqual({
      legend: [{ key: 'A', text: 'Patch existing slab.' }],
      instances: [
        { id: 'keyed-note-instance_patch-1', key: 'A', x: 2, y: 3 },
        { id: 'keyed-note-instance_patch-2', key: 'A', x: 4, y: 3 },
      ],
      warnings: [],
    })
  })

  test('reports keyed-note instances with missing definitions', () => {
    const sheet = DrawingSheetNode.parse({
      id: 'drawing-sheet_a101',
      keyedNoteInstances: [
        {
          id: 'keyed-note-instance_missing',
          definitionId: 'keyed-note_missing',
          position: [2, 3],
        },
      ],
    })

    expect(resolveDrawingSheetKeyedNotes(sheet).warnings).toEqual([
      {
        severity: 'warning',
        message:
          'Keyed-note symbol keyed-note-instance_missing references missing definition keyed-note_missing.',
      },
    ])
  })

  test('resolves scoped drawing sheet document markers', () => {
    const sheet = DrawingSheetNode.parse({
      id: 'drawing-sheet_a101',
      placedViews: [{ id: 'drawing-view_main', levelId: 'level_main' }],
      documentMarkers: [
        {
          id: 'sheet-marker_wall-a',
          kind: 'wall-tag',
          label: 'W1',
          placedViewId: 'drawing-view_main',
          position: [2, 3],
        },
        {
          id: 'sheet-marker_revision-a',
          kind: 'revision-cloud',
          label: '1',
          revisionId: 'A',
          points: [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
          ],
        },
        {
          id: 'sheet-marker_other-view',
          kind: 'detail-reference',
          label: '3',
          placedViewId: 'drawing-view_other',
          position: [5, 5],
        },
      ],
    })

    expect(resolveDrawingSheetDocumentMarkers(sheet, 'drawing-view_main')).toEqual([
      {
        id: 'sheet-marker_wall-a',
        kind: 'wall-tag',
        label: 'W1',
        title: '',
        sheetReference: '',
        drawingReference: '',
        revisionId: '',
        x: 2,
        y: 3,
        endX: null,
        endY: null,
        points: [],
      },
      {
        id: 'sheet-marker_revision-a',
        kind: 'revision-cloud',
        label: '1',
        title: '',
        sheetReference: '',
        drawingReference: '',
        revisionId: 'A',
        x: 0.5,
        y: 0.5,
        endX: null,
        endY: null,
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 2, y: 2 },
          { x: 1, y: 2 },
        ],
      },
    ])
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
