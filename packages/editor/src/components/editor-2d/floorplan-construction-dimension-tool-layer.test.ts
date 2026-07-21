import { describe, expect, test } from 'bun:test'
import { type MeasurementPoint, WallNode } from '@pascal-app/core'
import {
  buildConstructionDimensionPreviewGeometries,
  buildCurvedWallConstructionDimensionDraft,
  constructionDimensionUsesBaseline,
  normalizeConstructionDimensionChainMode,
  normalizeConstructionDimensionMode,
  resolveConstructionDimensionDraftDirection,
} from './floorplan-construction-dimension-tool-layer'

describe('continuous construction-dimension drafting', () => {
  test('derives a stable baseline direction from the first witness pair', () => {
    expect(
      resolveConstructionDimensionDraftDirection([
        [1, 0, 2],
        [4, 0, 6],
        [8, 0, 7],
      ]),
    ).toEqual([0.6, 0.8])
    expect(resolveConstructionDimensionDraftDirection([[1, 0, 2]])).toBeNull()
  })

  test('previews one adjacent dimension for every witness interval', () => {
    const geometry = buildConstructionDimensionPreviewGeometries(
      [
        [0, 0, 0],
        [2, 0, 0],
        [5, 0, 0],
        [9, 0, 0],
      ],
      [0, 0, 2],
      'metric',
    )

    expect(geometry).toHaveLength(3)
    expect(geometry.map((segment) => segment.text)).toEqual(['2m', '3m', '4m'])
    expect(geometry[1]).toMatchObject({
      start: [2, 0],
      end: [5, 0],
      dimensionStart: [2, 2],
      dimensionEnd: [5, 2],
    })
  })

  test('normalizes unknown tool defaults to the point-to-point workflow', () => {
    expect(normalizeConstructionDimensionChainMode('continuous')).toBe('continuous')
    expect(normalizeConstructionDimensionChainMode('unknown')).toBe('point-to-point')
  })

  test('normalizes curved and circular construction-dimension modes', () => {
    expect(normalizeConstructionDimensionMode('radius')).toBe('radius')
    expect(normalizeConstructionDimensionMode('arc-length')).toBe('arc-length')
    expect(normalizeConstructionDimensionMode('unknown')).toBe('linear')
  })

  test('previews radius and diameter notation before commit', () => {
    const points: MeasurementPoint[] = [
      [0, 0, 0],
      [2, 0, 0],
    ]
    expect(
      buildConstructionDimensionPreviewGeometries(points, [0, 0, 1], 'metric', 'radius')[0],
    ).toMatchObject({ text: 'R 2m' })
    expect(
      buildConstructionDimensionPreviewGeometries(points, [0, 0, 1], 'metric', 'diameter')[0],
    ).toMatchObject({ text: 'Ø 2m' })
    expect(
      buildConstructionDimensionPreviewGeometries(points, [0, 0, 1], 'metric', 'angular'),
    ).toEqual([])
  })

  test('only requests a label baseline for modes that use one', () => {
    expect(constructionDimensionUsesBaseline('linear')).toBe(true)
    expect(constructionDimensionUsesBaseline('radius')).toBe(true)
    expect(constructionDimensionUsesBaseline('angular')).toBe(true)
    expect(constructionDimensionUsesBaseline('diameter')).toBe(false)
    expect(constructionDimensionUsesBaseline('center-mark')).toBe(false)
    expect(constructionDimensionUsesBaseline('coordinate')).toBe(false)
  })

  test('derives associative radius, chord, arc, and center drafts from one curved wall', () => {
    const wall = WallNode.parse({
      id: 'wall_curve',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })

    expect(buildCurvedWallConstructionDimensionDraft(wall, 'radius')).toMatchObject({
      anchors: [
        { reference: { nodeId: wall.id, featureId: 'wall:curve:center' } },
        { reference: { nodeId: wall.id, featureId: 'wall:midpoint' } },
      ],
      points: [
        [2, 0, 1.5],
        [2, 0, -1],
      ],
    })
    expect(buildCurvedWallConstructionDimensionDraft(wall, 'chord')?.anchors).toMatchObject([
      { reference: { featureId: 'wall:start' } },
      { reference: { featureId: 'wall:end' } },
    ])
    expect(buildCurvedWallConstructionDimensionDraft(wall, 'arc-length')?.anchors).toMatchObject([
      { reference: { featureId: 'wall:curve:center' } },
      { reference: { featureId: 'wall:start' } },
      { reference: { featureId: 'wall:end' } },
    ])
    expect(buildCurvedWallConstructionDimensionDraft(wall, 'center-mark')?.anchors).toHaveLength(2)
  })

  test('keeps manual point drafting for straight walls and unsupported modes', () => {
    const straight = WallNode.parse({ start: [0, 0], end: [4, 0] })
    const curved = WallNode.parse({ start: [0, 0], end: [4, 0], curveOffset: 1 })

    expect(buildCurvedWallConstructionDimensionDraft(straight, 'radius')).toBeNull()
    expect(buildCurvedWallConstructionDimensionDraft(curved, 'diameter')).toBeNull()
    expect(buildCurvedWallConstructionDimensionDraft(curved, 'linear')).toBeNull()
  })
})
