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
})
