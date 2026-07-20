import { describe, expect, test } from 'bun:test'
import type { MeasurementPoint } from '@pascal-app/core'
import {
  buildConstructionDimensionPreviewGeometries,
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
})
