import { describe, expect, test } from 'bun:test'
import { type AnyNode, ConstructionDimensionNode } from '@pascal-app/core'
import { resolveNodeForDrawingType } from './drawing-coordination'

const foundation = ConstructionDimensionNode.parse({
  id: 'construction-dimension_foundation',
  drawingType: 'foundation-plan',
  anchors: [
    [0, 0, 0],
    [6, 0, 0],
  ],
  baseline: { origin: [0, 2], direction: [1, 0] },
})

describe('resolveNodeForDrawingType', () => {
  test('omits a dimension outside its primary drawing by default', () => {
    expect(
      resolveNodeForDrawingType(foundation, { [foundation.id]: foundation }, 'floor-plan'),
    ).toBeNull()
    expect(
      resolveNodeForDrawingType(foundation, { [foundation.id]: foundation }, 'foundation-plan'),
    ).toBe(foundation)
  })

  test('shows coordinated copies as references without changing their geometry', () => {
    const node = ConstructionDimensionNode.parse({
      drawingOverrides: [{ drawingType: 'roof-plan', presentation: 'reference' }],
    })
    const resolved = resolveNodeForDrawingType(node, { [node.id]: node }, 'roof-plan')
    expect(resolved).toMatchObject({
      id: node.id,
      anchors: node.anchors,
      metadata: { drawingCoordinationLocked: true },
      reference: true,
    })
  })

  test('applies view-specific suppressed segments without changing physical anchors', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
        [5, 0, 0],
      ],
      drawingOverrides: [
        {
          drawingType: 'floor-plan',
          presentation: 'shown',
          suppressedSegmentIndexes: [1],
        },
      ],
    })
    const resolved = resolveNodeForDrawingType(node, { [node.id]: node }, 'floor-plan')

    expect(resolved).toMatchObject({
      id: node.id,
      anchors: node.anchors,
      metadata: { suppressedDimensionSegmentIndexes: [1] },
    })
    expect(node.metadata).toEqual({})
  })

  test('retains suppressed segments on reference drawing copies', () => {
    const node = ConstructionDimensionNode.parse({
      drawingOverrides: [
        {
          drawingType: 'roof-plan',
          presentation: 'reference',
          suppressedSegmentIndexes: [0],
        },
      ],
    })
    const resolved = resolveNodeForDrawingType(node, { [node.id]: node }, 'roof-plan')

    expect(resolved).toMatchObject({
      reference: true,
      metadata: {
        drawingCoordinationLocked: true,
        suppressedDimensionSegmentIndexes: [0],
      },
    })
  })

  test('derives linked floor-plan geometry from a controlling foundation dimension', () => {
    const floor = ConstructionDimensionNode.parse({
      id: 'construction-dimension_floor',
      drawingOverrides: [{ drawingType: 'floor-plan', presentation: 'controlled' }],
      controllingDimensionId: foundation.id,
      anchors: [
        [1, 0, 1],
        [2, 0, 1],
      ],
    })
    const nodes = { [floor.id]: floor, [foundation.id]: foundation } as Record<string, AnyNode>
    const resolved = resolveNodeForDrawingType(floor, nodes, 'floor-plan')

    expect(resolved).toMatchObject({
      id: floor.id,
      anchors: foundation.anchors,
      baseline: foundation.baseline,
      metadata: { drawingCoordinationLocked: true },
      reference: true,
    })
  })

  test('marks a missing foundation controller as an unlinked reference', () => {
    const floor = ConstructionDimensionNode.parse({
      drawingOverrides: [{ drawingType: 'floor-plan', presentation: 'controlled' }],
      controllingDimensionId: 'construction-dimension_missing',
      prefix: 'TYP · ',
    })
    expect(resolveNodeForDrawingType(floor, { [floor.id]: floor }, 'floor-plan')).toMatchObject({
      prefix: 'UNLINKED CONTROL · TYP · ',
      reference: true,
    })
  })
})
