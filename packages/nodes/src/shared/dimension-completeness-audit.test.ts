import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  CabinetNode,
  ConstructionDimensionNode,
  DoorNode,
  StairNode,
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
      'undocumented-critical-node',
      'undocumented-critical-node',
    ])
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'missing-overall-dimension',
        nodeId: 'wall_exterior',
        severity: 'warning',
      }),
    )
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'missing-partition-reference',
        nodeId: 'wall_partition',
        severity: 'info',
      }),
    )
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

  test('can count the automatic wall and opening dimension plan as coverage', () => {
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
      roughOpeningWidth: 0.96,
    })

    expect(
      buildDimensionCompletenessAudit(nodes(exteriorWall, door), {
        includeAutomaticDimensions: true,
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
      'undocumented-critical-node',
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

    expect(issues.map((auditIssue) => auditIssue.kind)).toEqual([
      'missing-overall-dimension',
      'undocumented-critical-node',
    ])
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

  test('detects duplicate and contradictory dimension string overrides', () => {
    const wall = WallNode.parse({
      id: 'wall_exterior',
      start: [0, 0],
      end: [5, 0],
      frontSide: 'exterior',
    })
    const firstDimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_first',
      textOverride: '5.00m',
      anchors: [featureAnchor(wall.id, [0, 0, 0]), featureAnchor(wall.id, [5, 0, 0])],
    })
    const duplicateDimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_duplicate',
      textOverride: '5.00 m',
      anchors: [featureAnchor('wall_other', [0, 0, 0]), featureAnchor('wall_other', [5, 0, 0])],
    })
    const conflictingDimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_conflict',
      textOverride: '4.80m',
      anchors: [featureAnchor(wall.id, [0, 0, 0]), featureAnchor(wall.id, [4.8, 0, 0])],
    })

    const issues = buildDimensionCompletenessAudit(
      nodes(wall, firstDimension, duplicateDimension, conflictingDimension),
    )

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'duplicate-dimension-string',
        nodeId: 'construction-dimension_first',
      }),
    )
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'contradictory-dimension-string',
        nodeId: wall.id,
      }),
    )
  })

  test('detects continuous dimension segment totals that disagree with the overall string', () => {
    const dimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_chain',
      chainMode: 'continuous',
      textOverride: '3.00m',
      anchors: [
        featureAnchor('wall_a', [0, 0, 0]),
        featureAnchor('wall_b', [1, 0, 0]),
        featureAnchor('wall_c', [2, 0, 0]),
      ],
    })

    const issues = buildDimensionCompletenessAudit(nodes(dimension))

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'dimension-segment-total-mismatch',
        nodeId: 'construction-dimension_chain',
      }),
    ])
  })

  test('reports construction-critical nodes without dimensions or schedules', () => {
    const undocumentedCabinet = CabinetNode.parse({
      id: 'cabinet_undocumented',
    })
    const stair = StairNode.parse({
      id: 'stair_documented',
    })
    const stairDimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_stair',
      anchors: [featureAnchor(stair.id, [0, 0, 0]), featureAnchor(stair.id, [1, 0, 0])],
    })

    const issues = buildDimensionCompletenessAudit(
      nodes(undocumentedCabinet, stair, stairDimension),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'undocumented-critical-node',
        nodeId: undocumentedCabinet.id,
      }),
    ])
  })

  test('includes unresolved annotation collisions from preflight evidence', () => {
    const issues = buildDimensionCompletenessAudit(nodes(), {
      preflightIssues: [
        {
          id: 'dimension-label_wall_a',
          kind: 'unresolved-collision',
          severity: 'warning',
          message:
            'Wall A dimension label still overlaps another annotation after automatic layout.',
        },
        {
          id: 'dimension-label_wall_b',
          kind: 'short-unreadable-segment',
          severity: 'warning',
          message: 'Wall B uses an outside label.',
        },
      ],
    })

    expect(issues).toEqual([
      expect.objectContaining({
        id: 'dimension-completeness:unresolved-annotation-collision:dimension-label_wall_a',
        kind: 'unresolved-annotation-collision',
        nodeId: 'dimension-label_wall_a',
        nodeType: 'annotation',
      }),
    ])
  })

  test('includes clipped sheet content from sheet preflight evidence', () => {
    const issues = buildDimensionCompletenessAudit(nodes(), {
      preflightIssues: [
        {
          message:
            'Scaled plan exceeds the sheet viewport. Review clipped view or annotation content.',
        },
      ],
    })

    expect(issues).toEqual([
      expect.objectContaining({
        id: 'dimension-completeness:clipped-sheet-content:sheet',
        kind: 'clipped-sheet-content',
        nodeId: 'sheet',
        nodeType: 'sheet',
        severity: 'warning',
      }),
    ])
  })
})
