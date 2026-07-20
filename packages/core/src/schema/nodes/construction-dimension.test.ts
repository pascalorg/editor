import { describe, expect, test } from 'bun:test'
import { ConstructionDimensionNode } from './construction-dimension'

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
})
