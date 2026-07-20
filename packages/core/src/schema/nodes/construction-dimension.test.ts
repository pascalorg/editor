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
})
