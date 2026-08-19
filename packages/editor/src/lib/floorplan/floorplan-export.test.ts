import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry, NodeCategory } from '@pascal-app/core'
import { splitFloorplanOverlay } from '../../components/editor-2d/renderers/floorplan-registry-layer'
import { DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY } from './annotation-visibility'
import {
  filterFloorplanExportOverlay,
  fitPlanToBox,
  isFloorplanExportAnnotationGeometry,
  isFloorplanNodeInExportScope,
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

describe('isFloorplanNodeInExportScope', () => {
  const node = (category?: NodeCategory) => ({ category })

  test('includes structure-category nodes under structure, routing, and full', () => {
    expect(isFloorplanNodeInExportScope(node('structure'), 'structure')).toBe(true)
    expect(isFloorplanNodeInExportScope(node('structure'), 'routing')).toBe(true)
    expect(isFloorplanNodeInExportScope(node('structure'), 'full')).toBe(true)
  })

  test('includes utility-category nodes under routing and full, not structure', () => {
    expect(isFloorplanNodeInExportScope(node('utility'), 'routing')).toBe(true)
    expect(isFloorplanNodeInExportScope(node('utility'), 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(node('utility'), 'structure')).toBe(false)
  })

  test('includes furnish-category nodes only under full', () => {
    expect(isFloorplanNodeInExportScope(node('furnish'), 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(node('furnish'), 'structure')).toBe(false)
    expect(isFloorplanNodeInExportScope(node('furnish'), 'routing')).toBe(false)
  })

  test('includes analysis and site-category nodes only under full', () => {
    for (const category of ['analysis', 'site'] as const) {
      expect(isFloorplanNodeInExportScope(node(category), 'full')).toBe(true)
      expect(isFloorplanNodeInExportScope(node(category), 'structure')).toBe(false)
      expect(isFloorplanNodeInExportScope(node(category), 'routing')).toBe(false)
    }
  })

  test('excludes nodes with no category except under full', () => {
    expect(isFloorplanNodeInExportScope(node(undefined), 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(node(undefined), 'structure')).toBe(false)
    expect(isFloorplanNodeInExportScope(node(undefined), 'routing')).toBe(false)
  })

  test('handles an undefined definition like a no-category node', () => {
    expect(isFloorplanNodeInExportScope(undefined, 'full')).toBe(true)
    expect(isFloorplanNodeInExportScope(undefined, 'structure')).toBe(false)
    expect(isFloorplanNodeInExportScope(undefined, 'routing')).toBe(false)
  })
})
