import { describe, expect, test } from 'bun:test'
import {
  ConstructionDimensionNode,
  resolveConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingPresentation,
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
      reference: false,
      prefix: '',
      suffix: '',
      textOverride: null,
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
        reference: true,
      }).success,
    ).toBe(true)
    expect(ConstructionDimensionNode.safeParse({ mode: 'arc-length' }).success).toBe(true)
    expect(ConstructionDimensionNode.safeParse({ mode: 'angular' }).success).toBe(true)
    expect(ConstructionDimensionNode.safeParse({ featureCount: 0 }).success).toBe(false)
    expect(ConstructionDimensionNode.safeParse({ textOverride: '' }).success).toBe(false)
  })

  test('coordinates one associative dimension across persistent drawing types', () => {
    const node = ConstructionDimensionNode.parse({
      drawingType: 'foundation-plan',
      drawingOverrides: [
        { drawingType: 'floor-plan', presentation: 'controlled' },
        { drawingType: 'roof-plan', presentation: 'reference' },
      ],
      controllingDimensionId: 'construction-dimension_foundation',
    })

    expect(resolveConstructionDimensionDrawingPresentation(node, 'foundation-plan')).toBe('shown')
    expect(resolveConstructionDimensionDrawingPresentation(node, 'floor-plan')).toBe('controlled')
    expect(resolveConstructionDimensionDrawingPresentation(node, 'roof-plan')).toBe('reference')
    expect(resolveConstructionDimensionDrawingPresentation(node, 'site-plan')).toBe('omit')
  })

  test('stores only drawing presentations that differ from the primary defaults', () => {
    const node = ConstructionDimensionNode.parse({})
    const referenced = setConstructionDimensionDrawingPresentation(node, 'roof-plan', 'reference')
    expect(referenced).toEqual([{ drawingType: 'roof-plan', presentation: 'reference' }])
    expect(
      setConstructionDimensionDrawingPresentation(
        { ...node, drawingOverrides: referenced },
        'roof-plan',
        'omit',
      ),
    ).toEqual([])
  })
})
