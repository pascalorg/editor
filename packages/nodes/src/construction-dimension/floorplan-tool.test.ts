import { describe, expect, test } from 'bun:test'
import { type MeasurementPoint, WallNode } from '@pascal-app/core'
import {
  buildConstructionDimensionPreviewGeometries,
  buildCurvedWallConstructionDimensionDraft,
  constructionDimensionUsesBaseline,
  normalizeConstructionDimensionChainMode,
  normalizeConstructionDimensionMode,
  resolveConstructionDimensionDraftDirection,
  shouldConsumeConstructionDimensionPointerEvent,
} from './floorplan-tool'

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

  test('keeps an endpoint-to-face dimension aligned with the same straight wall', () => {
    const wall = WallNode.parse({
      id: 'wall_diagonal',
      start: [0, 0],
      end: [4, 4],
      thickness: 0.2,
    })
    const direction = resolveConstructionDimensionDraftDirection(
      [
        [4, 0, 4],
        [0.9292893219, 0, 1.0707106781],
      ],
      [
        {
          kind: 'feature',
          reference: { nodeId: wall.id, featureId: 'wall:end' },
          fallback: [4, 0, 4],
        },
        {
          kind: 'feature',
          reference: {
            nodeId: wall.id,
            featureId: 'wall:face:left',
            parameters: { t: 0.25 },
          },
          fallback: [0.9292893219, 0, 1.0707106781],
        },
      ],
      { [wall.id]: wall },
    )

    expect(direction?.[0]).toBeCloseTo(-Math.SQRT1_2)
    expect(direction?.[1]).toBeCloseTo(-Math.SQRT1_2)
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
    expect(geometry.map((segment) => segment.text)).toEqual(['2 m', '3 m', '4 m'])
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
    ).toMatchObject({ text: 'R 1 m' })
    expect(
      buildConstructionDimensionPreviewGeometries(points, [0, 0, 1], 'metric', 'diameter')[0],
    ).toMatchObject({ text: 'Ø 2 m' })
    expect(
      buildConstructionDimensionPreviewGeometries(points, [0, 0, 1], 'metric', 'angular'),
    ).toEqual([])
  })

  test('previews the arc value leader while placing the fourth point', () => {
    const preview = buildConstructionDimensionPreviewGeometries(
      [
        [2, 0, 0],
        [0, 0, 0],
        [0, 0, 2],
      ],
      [3, 0, 3],
      'metric',
      'arc-length',
    )

    expect(preview).toHaveLength(1)
    expect(preview[0]).toMatchObject({
      kind: 'group',
      children: expect.arrayContaining([
        expect.objectContaining({ kind: 'path' }),
        expect.objectContaining({ kind: 'line', x2: 3, y2: 3 }),
        expect.objectContaining({ kind: 'dimension-label', text: 'ARC 3,14 m' }),
      ]),
    })
  })

  test('previews the angular arc and value while placing the fourth point', () => {
    const preview = buildConstructionDimensionPreviewGeometries(
      [
        [2, 0, 0],
        [0, 0, 0],
        [0, 0, 2],
      ],
      [1.5, 0, 0.5],
      'metric',
      'angular',
    )

    expect(preview).toHaveLength(1)
    expect(preview[0]).toMatchObject({
      kind: 'group',
      children: expect.arrayContaining([
        expect.objectContaining({ kind: 'path' }),
        expect.objectContaining({ kind: 'line', x2: 1.5, y2: 0.5 }),
        expect.objectContaining({
          kind: 'dimension-label',
          cx: 1.5,
          cy: 0.5,
          text: '∠ 90°',
        }),
      ]),
    })
  })

  test('only requests a label baseline for modes that use one', () => {
    expect(constructionDimensionUsesBaseline('linear')).toBe(true)
    expect(constructionDimensionUsesBaseline('radius')).toBe(false)
    expect(constructionDimensionUsesBaseline('angular')).toBe(true)
    expect(constructionDimensionUsesBaseline('diameter')).toBe(false)
    expect(constructionDimensionUsesBaseline('center-mark')).toBe(false)
    expect(constructionDimensionUsesBaseline('coordinate')).toBe(false)
  })

  test('keeps radius manual while deriving chord and center drafts from one curved wall', () => {
    const wall = WallNode.parse({
      id: 'wall_curve',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })

    expect(buildCurvedWallConstructionDimensionDraft(wall, 'radius')).toBeNull()
    expect(buildCurvedWallConstructionDimensionDraft(wall, 'chord')?.anchors).toMatchObject([
      { reference: { featureId: 'wall:start' } },
      { reference: { featureId: 'wall:end' } },
    ])
    expect(buildCurvedWallConstructionDimensionDraft(wall, 'center-mark')?.anchors).toHaveLength(2)
  })

  test('keeps arc length in the manual start-center-end and baseline workflow', () => {
    const curved = WallNode.parse({ start: [0, 0], end: [4, 0], curveOffset: 1 })

    expect(buildCurvedWallConstructionDimensionDraft(curved, 'arc-length')).toBeNull()
    expect(constructionDimensionUsesBaseline('arc-length')).toBe(true)
  })

  test('keeps angular dimensions in the manual ray-center-ray and baseline workflow', () => {
    const curved = WallNode.parse({ start: [0, 0], end: [4, 0], curveOffset: 1 })

    expect(buildCurvedWallConstructionDimensionDraft(curved, 'angular')).toBeNull()
    expect(constructionDimensionUsesBaseline('angular')).toBe(true)
  })

  test('keeps manual point drafting for straight walls and unsupported modes', () => {
    const straight = WallNode.parse({ start: [0, 0], end: [4, 0] })
    const curved = WallNode.parse({ start: [0, 0], end: [4, 0], curveOffset: 1 })

    expect(buildCurvedWallConstructionDimensionDraft(straight, 'radius')).toBeNull()
    expect(buildCurvedWallConstructionDimensionDraft(curved, 'diameter')).toBeNull()
    expect(buildCurvedWallConstructionDimensionDraft(curved, 'linear')).toBeNull()
  })

  test('leaves middle-button drag moves available for floor-plan panning', () => {
    expect(
      shouldConsumeConstructionDimensionPointerEvent({
        type: 'pointermove',
        button: -1,
        buttons: 4,
      }),
    ).toBe(false)
  })
})
