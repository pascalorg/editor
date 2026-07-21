import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  ConstructionDimensionNode,
  DoorNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { buildDimensionCompletenessAudit } from './dimension-completeness-audit'

function nodes(...items: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<string, AnyNode>
}

function featureAnchor(nodeId: string, fallback: [number, number, number] = [0, 0, 0]) {
  return {
    kind: 'feature' as const,
    reference: { nodeId, featureId: 'center' },
    fallback,
  }
}

describe('dimension completeness audit', () => {
  test('reports missing overall exterior wall dimensions and partition references', () => {
    const exteriorWall = WallNode.parse({
      id: 'wall_exterior',
      start: [0, 0],
      end: [5, 0],
      frontSide: 'exterior',
    })
    const partitionWall = WallNode.parse({
      id: 'wall_partition',
      start: [1, 0],
      end: [1, 3],
      frontSide: 'interior',
      backSide: 'interior',
    })

    const issues = buildDimensionCompletenessAudit(nodes(exteriorWall, partitionWall))

    expect(issues.map((auditIssue) => auditIssue.kind)).toEqual([
      'missing-overall-dimension',
      'missing-partition-reference',
    ])
    expect(issues[0]).toMatchObject({
      nodeId: 'wall_exterior',
      severity: 'warning',
    })
    expect(issues[1]).toMatchObject({
      nodeId: 'wall_partition',
      severity: 'info',
    })
  })

  test('uses associative construction-dimension anchors as dimension coverage', () => {
    const exteriorWall = WallNode.parse({
      id: 'wall_exterior',
      start: [0, 0],
      end: [5, 0],
      frontSide: 'exterior',
    })
    const partitionWall = WallNode.parse({
      id: 'wall_partition',
      start: [1, 0],
      end: [1, 3],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const dimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_wall_refs',
      anchors: [
        featureAnchor(exteriorWall.id, [0, 0, 0]),
        featureAnchor(partitionWall.id, [1, 0, 0]),
      ],
    })

    expect(buildDimensionCompletenessAudit(nodes(exteriorWall, partitionWall, dimension))).toEqual(
      [],
    )
  })

  test('ignores reference dimensions unless explicitly included', () => {
    const exteriorWall = WallNode.parse({
      id: 'wall_exterior',
      start: [0, 0],
      end: [5, 0],
      frontSide: 'exterior',
    })
    const referenceDimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_reference',
      reference: true,
      anchors: [
        featureAnchor(exteriorWall.id, [0, 0, 0]),
        featureAnchor(exteriorWall.id, [5, 0, 0]),
      ],
    })

    expect(buildDimensionCompletenessAudit(nodes(exteriorWall, referenceDimension))).toHaveLength(1)
    expect(
      buildDimensionCompletenessAudit(nodes(exteriorWall, referenceDimension), {
        includeReferenceDimensions: true,
      }),
    ).toEqual([])
  })

  test('reports undimensioned exterior openings and missing verified rough openings', () => {
    const exteriorWall = WallNode.parse({
      id: 'wall_exterior',
      children: ['door_entry', 'window_front'],
      start: [0, 0],
      end: [5, 0],
      frontSide: 'exterior',
    })
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: exteriorWall.id,
      wallId: exteriorWall.id,
      width: 0.9,
    })
    const window = WindowNode.parse({
      id: 'window_front',
      parentId: exteriorWall.id,
      wallId: exteriorWall.id,
      roughOpeningWidth: 1.22,
    })

    const issues = buildDimensionCompletenessAudit(nodes(exteriorWall, door, window))

    expect(issues.map((auditIssue) => auditIssue.kind)).toEqual([
      'missing-overall-dimension',
      'missing-verified-rough-opening',
      'undimensioned-exterior-opening',
      'undimensioned-exterior-opening',
    ])
    expect(issues.filter((auditIssue) => auditIssue.nodeId === 'window_front')).toHaveLength(1)
  })

  test('suppresses exterior opening and rough-opening issues when evidence exists', () => {
    const exteriorWall = WallNode.parse({
      id: 'wall_exterior',
      children: ['door_entry'],
      start: [0, 0],
      end: [5, 0],
      frontSide: 'exterior',
    })
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: exteriorWall.id,
      wallId: exteriorWall.id,
      width: 0.9,
      roughOpeningWidth: 0.96,
    })
    const openingDimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_door',
      anchors: [featureAnchor(door.id, [2, 0, 0]), featureAnchor(door.id, [3, 0, 0])],
    })

    const issues = buildDimensionCompletenessAudit(nodes(exteriorWall, door, openingDimension))

    expect(issues.map((auditIssue) => auditIssue.kind)).toEqual(['missing-overall-dimension'])
  })

  test('can require rough-opening height verification as a stricter profile', () => {
    const door = DoorNode.parse({
      id: 'door_entry',
      roughOpeningWidth: 0.96,
    })

    expect(
      buildDimensionCompletenessAudit(nodes(door), { requireRoughOpeningHeights: true }),
    ).toMatchObject([
      {
        kind: 'missing-verified-rough-opening',
        nodeId: 'door_entry',
      },
    ])
  })

  test('does not require rough openings for masonry openings or frameless openings', () => {
    const masonryWindow = WindowNode.parse({
      id: 'window_masonry',
      constructionType: 'masonry',
    })
    const framelessOpening = DoorNode.parse({
      id: 'door_opening',
      openingKind: 'opening',
    })

    expect(buildDimensionCompletenessAudit(nodes(masonryWindow, framelessOpening))).toEqual([])
  })
})
