import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '../../registry/types'
import { LevelNode, WallNode } from '../../schema'
import {
  buildFloorplanContext,
  createFloorplanContextExtensions,
  floorplanAnnotationObstacleMode,
  floorplanGeometryMetadata,
  normalizeFloorplanWallDimensionFaces,
  readFloorplanContext,
} from './context'

function context(extensions?: Readonly<Record<string, unknown>>): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    extensions,
  }
}

describe('floor-plan context extensions', () => {
  test('measures walls to both faces by default', () => {
    expect(readFloorplanContext(context()).wallDimensionFaces).toBe('both')
  })

  test('carries the Measure walls choice', () => {
    for (const wallDimensionFaces of ['interior', 'exterior', 'both'] as const) {
      const extensions = createFloorplanContextExtensions({ wallDimensionFaces })
      expect(readFloorplanContext(context(extensions)).wallDimensionFaces).toBe(wallDimensionFaces)
    }
  })

  test('normalizes stale persisted values, including the retired references, to Both', () => {
    for (const stale of ['finished-faces', 'centerline', 'stud-faces', 'unknown', null]) {
      expect(normalizeFloorplanWallDimensionFaces(stale)).toBe('both')
    }
  })

  test('lets presentation code suppress automatic annotation construction', () => {
    expect(readFloorplanContext(context()).automaticDimensions).toBe(true)
    const extensions = createFloorplanContextExtensions({ automaticDimensions: false })
    expect(readFloorplanContext(context(extensions)).automaticDimensions).toBe(false)
  })
})

const viewState = {
  selected: false,
  unit: 'metric' as const,
  highlighted: false,
  hovered: false,
  moving: false,
  palette: undefined,
}

describe('read-only floorplan context', () => {
  test('does not invent siblings for parentless nodes', () => {
    const first = LevelNode.parse({ id: 'level_first', type: 'level' })
    const second = LevelNode.parse({ id: 'level_second', type: 'level' })
    const nodes = { [first.id]: first, [second.id]: second }

    expect(buildFloorplanContext(first, nodes, viewState).siblings).toEqual([])
  })

  test('resolves same-kind siblings from the parent child order', () => {
    const first = WallNode.parse({
      id: 'wall_first',
      type: 'wall',
      parentId: 'level_ground',
      start: [0, 0],
      end: [1, 0],
    })
    const second = WallNode.parse({
      id: 'wall_second',
      type: 'wall',
      parentId: 'level_ground',
      start: [1, 0],
      end: [2, 0],
    })
    const level = LevelNode.parse({
      id: 'level_ground',
      type: 'level',
      children: [first.id, second.id],
    })
    const nodes = { [level.id]: level, [first.id]: first, [second.id]: second }

    expect(buildFloorplanContext(first, nodes, viewState).siblings).toEqual([second])
  })
})

describe('floorplanAnnotationObstacleMode', () => {
  test('treats fixed annotation categories as layout obstacles', () => {
    expect(
      floorplanAnnotationObstacleMode({
        kind: 'text',
        x: 0,
        y: 0,
        text: 'BEDROOM',
        fontSize: 0.18,
        metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
      }),
    ).toBe('bounds')
    expect(
      floorplanAnnotationObstacleMode({
        kind: 'line',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
        metadata: floorplanGeometryMetadata({ annotationRole: 'column-center' }),
      }),
    ).toBe('bounds')
    expect(
      floorplanAnnotationObstacleMode({
        kind: 'polyline',
        points: [
          [0, 0],
          [1, 0],
        ],
        metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
      }),
    ).toBe('outline')
  })
})
