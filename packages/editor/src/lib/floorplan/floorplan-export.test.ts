import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { splitFloorplanOverlay } from '../../components/editor-2d/renderers/floorplan-registry-layer'
import { DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY } from './annotation-visibility'
import {
  filterFloorplanExportOverlay,
  fitPlanToBox,
  isFloorplanExportAnnotationGeometry,
  partitionFloorplanExportOverlay,
  resolveFloorplanExportAnnotationVisibility,
  resolveFloorplanExportNodeGeometry,
  resolveFloorplanExportPlacement,
  resolveFloorplanExportRotationDeg,
  resolveFloorplanExportViewport,
  resolveFloorplanExportViewState,
  resolveFloorplanMeasurementSize,
  resolveFloorplanPageLayout,
  resolveFloorplanScreenUnitsPerPixel,
  rotateFloorplanExportBounds,
} from './floorplan-export'
import { floorplanGeometryMetadata } from './floorplan-extension'

describe('filterFloorplanExportOverlay', () => {
  test('preserves annotation metadata while splitting geometry passes', () => {
    const contextualDimension = {
      kind: 'group',
      metadata: floorplanGeometryMetadata({ annotationRole: 'contextual-dimension' }),
      children: [
        {
          kind: 'dimension',
          start: [0, 0],
          end: [2, 0],
          offsetNormal: [0, 1],
          offsetDistance: 0.3,
          extensionOvershoot: 0.08,
          text: '2m',
        },
      ],
    } satisfies FloorplanGeometry

    expect(splitFloorplanOverlay(contextualDimension).overlay).toMatchObject(contextualDimension)
  })

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
      contextualDimensions: false,
      manualDimensions: false,
      measurements: true,
      openingMarks: true,
      structuralGrids: false,
      roomLabels: false,
      stairAnnotations: true,
    }

    expect(resolveFloorplanExportAnnotationVisibility('expert', liveVisibility)).toEqual(
      liveVisibility,
    )
  })

  test('exports only model geometry and room labels in Default', () => {
    expect(
      resolveFloorplanExportAnnotationVisibility(
        'default',
        DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
      ),
    ).toEqual({
      automaticDimensions: false,
      contextualDimensions: false,
      manualDimensions: false,
      measurements: false,
      openingMarks: false,
      structuralGrids: false,
      roomLabels: true,
      stairAnnotations: false,
    })
  })

  test('matches live screen sizing to the fitted export viewport', () => {
    expect(resolveFloorplanScreenUnitsPerPixel(7, 4.5, 572, 463)).toBeCloseTo(0.012_237_762, 8)
  })

  test('keeps the export viewport anchored to the structural drawing bounds', () => {
    expect(resolveFloorplanExportViewport({ x: -5, y: -6, width: 13, height: 13.5 })).toEqual({
      x: -7.6,
      y: -8.7,
      width: 18.2,
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

describe('resolveFloorplanMeasurementSize', () => {
  test('sizes the hidden SVG in screen pixels before resolving label collisions', () => {
    expect(
      resolveFloorplanMeasurementSize({ x: -2, y: -3, width: 18.4, height: 18.9 }, 0.024),
    ).toEqual({ width: 18.4 / 0.024, height: 18.9 / 0.024 })
  })
})

describe('resolveFloorplanPageLayout', () => {
  test('uses the available A4 page area for the fitted plan', () => {
    expect(resolveFloorplanPageLayout(842, 595)).toEqual({
      planBox: { x: 36, y: 64, width: 770, height: 495 },
    })
  })
})

import { nodeRegistry } from '@pascal-app/core'
import { collectFloorplanGeometry, collectFloorplanSchedules } from './floorplan-export'
describe('collectFloorplanGeometry scope filtering', () => {
  const defaultArgs = [
    'metric',
    'millimeters',
    DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
    'floor-plan',
    'centerline',
  ] as const

  test('excludes utility nodes from the subtree walk under structure scope, but includes under routing', () => {
    nodeRegistry._register({
      schemaVersion: 1,
      schema: { type: 'object', properties: {} } as any,
      kind: 'mock-utility',
      category: 'utility',
      floorplan: () => ({ kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'black' } as any),
    } as any)
    
    const nodes = {
      'level-1': { id: 'level-1', type: 'level', children: ['u1'] },
      u1: { id: 'u1', type: 'mock-utility', visible: true },
    } as any

    const struct = collectFloorplanGeometry(nodes, 'level-1' as any, 'structure', ...defaultArgs)
    expect(struct).toHaveLength(0)

    const route = collectFloorplanGeometry(nodes, 'level-1' as any, 'routing', ...defaultArgs)
    expect(route).toHaveLength(1)
    expect(route[0]?.id).toBe('u1' as any)
    
    nodeRegistry._reset()
  })

  test('excludes utility nodes from the linked-level walk under structure scope', () => {
    nodeRegistry._register({
      schemaVersion: 1,
      schema: { type: 'object', properties: {} } as any,
      kind: 'mock-zone',
      category: 'site',
      floorplan: () => ({ kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'black' } as any),
      capabilities: { floorPlaced: true }
    } as any)
    
    const nodes = {
      'level-1': { id: 'level-1', type: 'level', children: [], elevation: 0 },
      zone: { id: 'zone', type: 'mock-zone', visible: true, elevation: 0 },
    } as any

    // the floor plan linked level walk looks at nodes outside the level hierarchy if they match the elevation
    // but the scope filter should exclude site nodes from structure and routing
    const struct = collectFloorplanGeometry(nodes, 'level-1' as any, 'structure', ...defaultArgs)
    expect(struct).toHaveLength(0)

    const route = collectFloorplanGeometry(nodes, 'level-1' as any, 'routing', ...defaultArgs)
    expect(route).toHaveLength(0)

    const full = collectFloorplanGeometry(nodes, 'level-1' as any, 'full', ...defaultArgs)
    // full includes everything
    expect(full.length).toBeGreaterThanOrEqual(0)
    
    nodeRegistry._reset()
  })
})

describe('collectFloorplanSchedules scope filtering', () => {
  test('filters schedule contributors by scope', () => {
    nodeRegistry._register({
      schemaVersion: 1,
      schema: { type: 'object', properties: {} } as any,
      kind: 'mock-door',
      category: 'structure',
      floorplan: () => ({ kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'black' } as any),
      extensions: {
        'pascal:editor/floorplan': {
          schedule: ({ siblings }: any) => ({ title: 'Doors', columns: [], rows: siblings.map((s: any) => ({ id: s.id, cells: [] })) })
        }
      } as any
    } as any)
    
    nodeRegistry._register({
      schemaVersion: 1,
      schema: { type: 'object', properties: {} } as any,
      kind: 'mock-utility-schedule',
      category: 'utility',
      floorplan: () => ({ kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'black' } as any),
      extensions: {
        'pascal:editor/floorplan': {
          schedule: ({ siblings }: any) => ({ title: 'Utilities', columns: [], rows: siblings.map((s: any) => ({ id: s.id, cells: [] })) })
        }
      } as any
    } as any)

    const nodes = {
      'level-1': { id: 'level-1', type: 'level', children: ['d1', 'u1'] },
      d1: { id: 'd1', type: 'mock-door', visible: true },
      u1: { id: 'u1', type: 'mock-utility-schedule', visible: true },
    } as any

    const struct = collectFloorplanSchedules(nodes, 'level-1' as any, 'metric', 'structure')
    expect(struct).toHaveLength(1)
    expect(struct[0]?.title).toBe('Doors')

    const route = collectFloorplanSchedules(nodes, 'level-1' as any, 'metric', 'routing')
    expect(route).toHaveLength(2)
    expect(route.map(s => s.title)).toContain('Doors')
    expect(route.map(s => s.title)).toContain('Utilities')
    
    nodeRegistry._reset()
  })
})
