import { describe, expect, test } from 'bun:test'
import {
  ConstructionDimensionNode,
  resolveConstructionDimensionDrawingOverride,
  resolveConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingSuppressedSegments,
} from './construction-dimension'

describe('ConstructionDimensionNode', () => {
  test('creates valid free-anchor defaults', () => {
    const node = ConstructionDimensionNode.parse({})

    expect(node.type).toBe('construction-dimension')
    expect(node.id).toMatch(/^construction-dimension_/)
    expect(node.anchors).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ])
    expect(node.baseline).toEqual({ origin: [0, 0.6], direction: [1, 0] })
    expect(node.chainMode).toBe('point-to-point')
    expect(node).toMatchObject({
      mode: 'linear',
      featureCount: 1,
      showCenterMark: true,
      prefix: '',
      suffix: '',
      textOverride: null,
      datumPolicy: 'centerline',
      terminator: 'architectural-tick',
      textPosition: 'above',
      imperialPrecision: '1/16',
      metricNotation: 'meters',
      extensionStartGap: 0.075,
      extensionOvershoot: 0.12,
      drawingType: 'floor-plan',
      drawingOverrides: [],
      controllingDimensionId: null,
    })
  })

  test('accepts semantic anchors and rejects a collapsed baseline direction', () => {
    expect(
      ConstructionDimensionNode.safeParse({
        anchors: [
          {
            kind: 'feature',
            reference: { nodeId: 'wall_a', featureId: 'centerline', parameters: { t: 0.25 } },
            fallback: [1, 0, 0],
          },
          [3, 0, 0],
        ],
      }).success,
    ).toBe(true)
    expect(
      ConstructionDimensionNode.safeParse({
        baseline: { origin: [0, 0], direction: [0, 0] },
      }).success,
    ).toBe(false)
  })

  test('accepts continuous strings with three or more anchors', () => {
    expect(
      ConstructionDimensionNode.safeParse({
        anchors: [
          [0, 0, 0],
          [2, 0, 0],
          [5, 0, 0],
        ],
        chainMode: 'continuous',
      }).success,
    ).toBe(true)
    expect(
      ConstructionDimensionNode.safeParse({ anchors: [[0, 0, 0]], chainMode: 'continuous' })
        .success,
    ).toBe(false)
  })

  test('accepts curved and circular notation settings', () => {
    expect(
      ConstructionDimensionNode.safeParse({
        mode: 'diameter',
        featureCount: 6,
        prefix: 'TYP · ',
        suffix: ' CLR',
      }).success,
    ).toBe(true)
    expect(ConstructionDimensionNode.safeParse({ mode: 'arc-length' }).success).toBe(true)
    expect(ConstructionDimensionNode.safeParse({ mode: 'angular' }).success).toBe(true)
    expect(ConstructionDimensionNode.safeParse({ featureCount: 0 }).success).toBe(false)
    expect(ConstructionDimensionNode.safeParse({ textOverride: '' }).success).toBe(false)
  })

  test('accepts dimension-standard overrides and rejects invalid drafting distances', () => {
    const node = ConstructionDimensionNode.parse({
      datumPolicy: 'finish-face',
      terminator: 'filled-arrow',
      textPosition: 'centered',
      imperialPrecision: '1/8',
      metricNotation: 'millimeters',
      extensionStartGap: 0.025,
      extensionOvershoot: 0.08,
    })

    expect(node).toMatchObject({
      datumPolicy: 'finish-face',
      terminator: 'filled-arrow',
      textPosition: 'centered',
      imperialPrecision: '1/8',
      metricNotation: 'millimeters',
      extensionStartGap: 0.025,
      extensionOvershoot: 0.08,
    })
    expect(ConstructionDimensionNode.safeParse({ extensionStartGap: -0.01 }).success).toBe(false)
    expect(ConstructionDimensionNode.safeParse({ extensionOvershoot: 2 }).success).toBe(false)
  })

  test('coordinates one associative dimension across persistent drawing types', () => {
    const node = ConstructionDimensionNode.parse({
      drawingType: 'foundation-plan',
      drawingOverrides: [
        { drawingType: 'floor-plan', presentation: 'controlled' },
        { drawingType: 'roof-plan', presentation: 'shown' },
      ],
      controllingDimensionId: 'construction-dimension_foundation',
    })

    expect(resolveConstructionDimensionDrawingPresentation(node, 'foundation-plan')).toBe('shown')
    expect(resolveConstructionDimensionDrawingPresentation(node, 'floor-plan')).toBe('controlled')
    expect(resolveConstructionDimensionDrawingPresentation(node, 'roof-plan')).toBe('shown')
    expect(resolveConstructionDimensionDrawingPresentation(node, 'site-plan')).toBe('omit')
  })

  test('stores only drawing presentations that differ from the primary defaults', () => {
    const node = ConstructionDimensionNode.parse({})
    const shown = setConstructionDimensionDrawingPresentation(node, 'roof-plan', 'shown')
    expect(shown).toEqual([
      { drawingType: 'roof-plan', presentation: 'shown', suppressedSegmentIndexes: [] },
    ])
    expect(
      setConstructionDimensionDrawingPresentation(
        { ...node, drawingOverrides: shown },
        'roof-plan',
        'omit',
      ),
    ).toEqual([])
  })

  test('stores view-specific suppressed segment indexes without changing default presentation', () => {
    const node = ConstructionDimensionNode.parse({})
    const drawingOverrides = setConstructionDimensionDrawingSuppressedSegments(
      node,
      'floor-plan',
      [3, 1, 1, -1],
    )

    expect(drawingOverrides).toEqual([
      {
        drawingType: 'floor-plan',
        presentation: 'shown',
        suppressedSegmentIndexes: [1, 3],
      },
    ])
    expect(
      resolveConstructionDimensionDrawingOverride({ ...node, drawingOverrides }, 'floor-plan')
        ?.suppressedSegmentIndexes,
    ).toEqual([1, 3])
    expect(
      setConstructionDimensionDrawingSuppressedSegments(
        { ...node, drawingOverrides },
        'floor-plan',
        [],
      ),
    ).toEqual([])
  })
})
