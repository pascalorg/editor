import {
  type AnyNode,
  type ConstructionDimensionNode,
  type DoorNode,
  measurementAnchorReferenceNodeIds,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'

export type DimensionCompletenessIssueKind =
  | 'missing-overall-dimension'
  | 'undimensioned-exterior-opening'
  | 'missing-partition-reference'
  | 'missing-verified-rough-opening'

export type DimensionCompletenessIssueSeverity = 'info' | 'warning'

export type DimensionCompletenessIssue = {
  id: string
  kind: DimensionCompletenessIssueKind
  nodeId: string
  nodeType: string
  severity: DimensionCompletenessIssueSeverity
  message: string
}

export type BuildDimensionCompletenessAuditOptions = {
  includeReferenceDimensions?: boolean
  requireRoughOpeningHeights?: boolean
}

type DimensionCoverage = ReadonlySet<string>
type OpeningNode = DoorNode | WindowNode

export function buildDimensionCompletenessAudit(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BuildDimensionCompletenessAuditOptions = {},
): DimensionCompletenessIssue[] {
  const coverage = dimensionCoverage(nodes, options)
  const issues: DimensionCompletenessIssue[] = []

  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      issues.push(...wallDimensionIssues(node, coverage))
      continue
    }

    if (node.type === 'door' || node.type === 'window') {
      issues.push(...openingDimensionIssues(node, nodes, coverage, options))
    }
  }

  return issues.sort((left, right) => left.id.localeCompare(right.id))
}

function dimensionCoverage(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BuildDimensionCompletenessAuditOptions,
): DimensionCoverage {
  const covered = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'construction-dimension') continue
    if (node.reference && options.includeReferenceDimensions !== true) continue

    for (const nodeId of measurementAnchorReferenceNodeIds(
      (node as ConstructionDimensionNode).anchors,
    )) {
      covered.add(nodeId)
    }
  }
  return covered
}

function wallDimensionIssues(
  wall: WallNode,
  coverage: DimensionCoverage,
): DimensionCompletenessIssue[] {
  if (coverage.has(wall.id)) return []

  if (isExteriorWall(wall)) {
    return [
      issue(
        'missing-overall-dimension',
        wall,
        'warning',
        `Exterior wall ${wall.id} has no associative overall construction dimension.`,
      ),
    ]
  }

  if (isPartitionWall(wall)) {
    return [
      issue(
        'missing-partition-reference',
        wall,
        'info',
        `Partition wall ${wall.id} has no associative partition reference dimension.`,
      ),
    ]
  }

  return []
}

function openingDimensionIssues(
  opening: OpeningNode,
  nodes: Readonly<Record<string, AnyNode>>,
  coverage: DimensionCoverage,
  options: BuildDimensionCompletenessAuditOptions,
): DimensionCompletenessIssue[] {
  const issues: DimensionCompletenessIssue[] = []
  const hostWall = openingHostWall(opening, nodes)

  if (hostWall && isExteriorWall(hostWall) && !coverage.has(opening.id)) {
    issues.push(
      issue(
        'undimensioned-exterior-opening',
        opening,
        'warning',
        `${titleCase(opening.type)} ${opening.id} is on exterior wall ${hostWall.id} but has no associative opening dimension.`,
      ),
    )
  }

  if (missingVerifiedRoughOpening(opening, options)) {
    issues.push(
      issue(
        'missing-verified-rough-opening',
        opening,
        'info',
        `${titleCase(opening.type)} ${opening.id} has no verified rough-opening ${options.requireRoughOpeningHeights === true ? 'width and height' : 'width'} recorded.`,
      ),
    )
  }

  return issues
}

function openingHostWall(
  opening: OpeningNode,
  nodes: Readonly<Record<string, AnyNode>>,
): WallNode | null {
  const hostId = opening.wallId ?? opening.parentId ?? null
  if (!hostId) return null
  const host = nodes[hostId]
  return host?.type === 'wall' ? host : null
}

function missingVerifiedRoughOpening(
  opening: OpeningNode,
  options: BuildDimensionCompletenessAuditOptions,
): boolean {
  if (opening.openingKind === 'opening') return false
  if (opening.constructionType === 'masonry') return false
  if (opening.roughOpeningWidth === undefined) return true
  return options.requireRoughOpeningHeights === true && opening.roughOpeningHeight === undefined
}

function isExteriorWall(wall: WallNode): boolean {
  return wall.frontSide === 'exterior' || wall.backSide === 'exterior'
}

function isPartitionWall(wall: WallNode): boolean {
  return wall.frontSide === 'interior' || wall.backSide === 'interior'
}

function issue(
  kind: DimensionCompletenessIssueKind,
  node: Pick<AnyNode, 'id' | 'type'>,
  severity: DimensionCompletenessIssueSeverity,
  message: string,
): DimensionCompletenessIssue {
  return {
    id: ['dimension-completeness', kind, node.id].join(':'),
    kind,
    nodeId: node.id,
    nodeType: node.type,
    severity,
    message,
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
