import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
  filterFloorplanAnnotationGeometry,
  normalizeFloorplanAnnotationVisibility,
} from './annotation-visibility'

describe('floor-plan annotation visibility', () => {
  test('fills missing persisted categories with visible defaults', () => {
    expect(normalizeFloorplanAnnotationVisibility({ measurements: false })).toEqual({
      ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
      measurements: false,
    })
  })

  test('removes automatic dimension primitives without removing plan geometry', () => {
    const line = { kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 } satisfies FloorplanGeometry
    const geometry = {
      kind: 'group',
      children: [
        line,
        {
          kind: 'dimension',
          start: [0, 0],
          end: [2, 0],
          offsetNormal: [0, 1],
          offsetDistance: 0.3,
          extensionOvershoot: 0.1,
          text: '2.00m',
        },
      ],
    } satisfies FloorplanGeometry

    expect(
      filterFloorplanAnnotationGeometry('wall', geometry, {
        ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        automaticDimensions: false,
      }),
    ).toEqual({ kind: 'group', children: [line] })
  })

  test('removes only the opening mark from door geometry', () => {
    const body = {
      kind: 'polygon',
      points: [
        [0, 0],
        [1, 0],
        [1, 0.1],
      ],
    } satisfies FloorplanGeometry
    const mark = {
      kind: 'group',
      children: [
        { kind: 'line', x1: 0.5, y1: 0, x2: 0.5, y2: 0.5 },
        { kind: 'rect', x: 0.3, y: 0.5, width: 0.4, height: 0.3 },
        { kind: 'text', x: 0.5, y: 0.65, text: '101', fontSize: 0.15, upright: true },
      ],
    } satisfies FloorplanGeometry
    const geometry = { kind: 'group', children: [body, mark] } satisfies FloorplanGeometry

    expect(
      filterFloorplanAnnotationGeometry('door', geometry, {
        ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        openingMarks: false,
      }),
    ).toEqual({ kind: 'group', children: [body] })
  })

  test('hides manual dimensions, measurements, and construction notes independently', () => {
    const geometry = {
      kind: 'text',
      x: 0,
      y: 0,
      text: 'Annotation',
      fontSize: 0.15,
    } satisfies FloorplanGeometry

    expect(
      filterFloorplanAnnotationGeometry('construction-dimension', geometry, {
        ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        manualDimensions: false,
      }),
    ).toBeNull()
    expect(
      filterFloorplanAnnotationGeometry(
        'construction-dimension',
        {
          kind: 'dimension',
          start: [0, 0],
          end: [1, 0],
          offsetNormal: [0, 1],
          offsetDistance: 0.5,
          extensionOvershoot: 0.1,
          text: '1m',
        },
        {
          ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
          automaticDimensions: false,
        },
      ),
    ).not.toBeNull()
    expect(
      filterFloorplanAnnotationGeometry('measurement', geometry, {
        ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        measurements: false,
      }),
    ).toBeNull()
    expect(
      filterFloorplanAnnotationGeometry('construction-note', geometry, {
        ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
        constructionNotes: false,
      }),
    ).toBeNull()
  })

  test('hides structural grids and only the center marks within column geometry', () => {
    const centerMark = {
      kind: 'line',
      x1: -0.1,
      y1: -0.1,
      x2: 0.1,
      y2: 0.1,
      annotationRole: 'column-center',
    } satisfies FloorplanGeometry
    const gridReference = {
      kind: 'text',
      x: 0,
      y: 0.3,
      text: 'B-2',
      fontSize: 0.13,
      annotationRole: 'column-center',
    } satisfies FloorplanGeometry
    const footprint = {
      kind: 'rect',
      x: -0.2,
      y: -0.2,
      width: 0.4,
      height: 0.4,
    } satisfies FloorplanGeometry
    const visibility = {
      ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
      structuralGrids: false,
    }

    expect(
      filterFloorplanAnnotationGeometry(
        'column',
        {
          kind: 'group',
          children: [footprint, centerMark, gridReference],
        },
        visibility,
      ),
    ).toEqual({ kind: 'group', children: [footprint] })
    expect(filterFloorplanAnnotationGeometry('structural-grid', footprint, visibility)).toBeNull()
  })

  test('hides room labels without removing the room footprint', () => {
    const footprint = {
      kind: 'polygon',
      points: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
    } satisfies FloorplanGeometry
    const roomName = {
      kind: 'text',
      x: 2,
      y: 1.5,
      text: 'Office',
      fontSize: 0.2,
      annotationRole: 'room-label',
    } satisfies FloorplanGeometry

    expect(
      filterFloorplanAnnotationGeometry(
        'zone',
        { kind: 'group', children: [footprint, roomName] },
        { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, roomLabels: false },
      ),
    ).toEqual({ kind: 'group', children: [footprint] })
  })

  test('hides stair notes and break lines without removing stair geometry', () => {
    const footprint = {
      kind: 'polygon',
      points: [
        [0, 0],
        [1, 0],
        [1, 3],
        [0, 3],
      ],
    } satisfies FloorplanGeometry
    const direction = {
      kind: 'text',
      x: 0.5,
      y: 0.5,
      text: 'UP',
      fontSize: 0.16,
      annotationRole: 'stair-annotation',
    } satisfies FloorplanGeometry
    const breakLine = {
      kind: 'polyline',
      points: [
        [0, 2],
        [1, 2],
      ],
      annotationRole: 'stair-annotation',
    } satisfies FloorplanGeometry

    expect(
      filterFloorplanAnnotationGeometry(
        'stair',
        { kind: 'group', children: [footprint, direction, breakLine] },
        { ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, stairAnnotations: false },
      ),
    ).toEqual({ kind: 'group', children: [footprint] })
  })
})
