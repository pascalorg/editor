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
  | 'duplicate-dimension-string'
  | 'contradictory-dimension-string'
  | 'dimension-segment-total-mismatch'
  | 'undocumented-critical-node'
  | 'unresolved-annotation-collision'
  | 'clipped-sheet-content'

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
  includeAutomaticDimensions?: boolean
  requireRoughOpeningHeights?: boolean
  dimensionValueTolerance?: number
  preflightIssues?: readonly DimensionCompletenessPreflightIssue[]
}

export type DimensionCompletenessPreflightIssue = {
  id?: string
  kind?: string
  severity?: DimensionCompletenessIssueSeverity
  message: string
}

type DimensionCoverage = ReadonlySet<string>
type DocumentationCoverage = {
  dimensioned: ReadonlySet<string>
  scheduled: ReadonlySet<string>
}
type OpeningNode = DoorNode | WindowNode
type DimensionRecord = {
  dimension: ConstructionDimensionNode
  referencedNodeIds: readonly string[]
  normalizedText: string | null
  parsedTextValue: number | null
  segmentTotal: number | null
}

export function buildDimensionCompletenessAudit(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BuildDimensionCompletenessAuditOptions = {},
): DimensionCompletenessIssue[] {
  const coverage = dimensionCoverage(nodes, options)
  const documentation = documentationCoverage(nodes, coverage)
  const issues: DimensionCompletenessIssue[] = []

  issues.push(...dimensionStringIssues(nodes, options))
  issues.push(...preflightCompletenessIssues(options.preflightIssues ?? []))

  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      issues.push(...wallDimensionIssues(node, coverage))
    } else if (node.type === 'door' || node.type === 'window') {
      issues.push(...openingDimensionIssues(node, nodes, coverage, options))
    }

    if (isConstructionCriticalNode(node, nodes) && !hasDocumentationCoverage(node, documentation)) {
      issues.push(
        issue(
          'undocumented-critical-node',
          node,
          'warning',
          `${titleCase(node.type)} ${node.id} has no construction dimension or schedule entry.`,
        ),
      )
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

    for (const nodeId of measurementAnchorReferenceNodeIds(
      (node as ConstructionDimensionNode).anchors,
    )) {
      covered.add(nodeId)
    }
  }
  if (options.includeAutomaticDimensions === true) {
    for (const node of Object.values(nodes)) {
      if (
        node.type === 'wall' &&
        node.visible !== false &&
        Math.abs(node.curveOffset ?? 0) <= 1e-6 &&
        (isExteriorWall(node) || isPartitionWall(node))
      ) {
        covered.add(node.id)
      }
    }
    for (const node of Object.values(nodes)) {
      if (node.type !== 'door' && node.type !== 'window') continue
      const host = openingHostWall(node, nodes)
      if (host && covered.has(host.id)) covered.add(node.id)
    }
  }
  return covered
}

function documentationCoverage(
  nodes: Readonly<Record<string, AnyNode>>,
  dimensioned: DimensionCoverage,
): DocumentationCoverage {
  const scheduled = new Set<string>()

  for (const node of Object.values(nodes)) {
    if (hasGeneratedScheduleEntry(node)) scheduled.add(node.id)
  }

  return { dimensioned, scheduled }
}

function dimensionStringIssues(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BuildDimensionCompletenessAuditOptions,
): DimensionCompletenessIssue[] {
  const records = Object.values(nodes)
    .filter((node): node is ConstructionDimensionNode => node.type === 'construction-dimension')
    .map((dimension) => dimensionRecord(dimension))
  const issues: DimensionCompletenessIssue[] = []

  issues.push(...duplicateDimensionStringIssues(records))
  issues.push(...contradictoryDimensionStringIssues(records))
  issues.push(...segmentTotalMismatchIssues(records, options.dimensionValueTolerance ?? 0.005))

  return issues
}

function dimensionRecord(dimension: ConstructionDimensionNode): DimensionRecord {
  const normalizedText = normalizedDimensionText(dimension.textOverride)
  return {
    dimension,
    referencedNodeIds: measurementAnchorReferenceNodeIds(dimension.anchors),
    normalizedText,
    parsedTextValue: normalizedText ? parseDimensionTextValue(normalizedText) : null,
    segmentTotal: continuousSegmentTotal(dimension),
  }
}

function duplicateDimensionStringIssues(
  records: readonly DimensionRecord[],
): DimensionCompletenessIssue[] {
  const byText = new Map<string, DimensionRecord[]>()
  for (const record of records) {
    if (!record.normalizedText) continue
    const existing = byText.get(record.normalizedText)
    if (existing) existing.push(record)
    else byText.set(record.normalizedText, [record])
  }

  const issues: DimensionCompletenessIssue[] = []
  for (const [text, duplicates] of byText) {
    if (duplicates.length < 2) continue
    const dimension = duplicates[0]?.dimension
    if (!dimension) continue
    issues.push(
      issue(
        'duplicate-dimension-string',
        dimension,
        'info',
        `Dimension string "${text}" is used by ${duplicates.length} construction dimensions.`,
      ),
    )
  }
  return issues
}

function contradictoryDimensionStringIssues(
  records: readonly DimensionRecord[],
): DimensionCompletenessIssue[] {
  const byNode = new Map<string, Map<string, DimensionRecord[]>>()
  for (const record of records) {
    if (!record.normalizedText) continue
    for (const nodeId of record.referencedNodeIds) {
      const byText = byNode.get(nodeId) ?? new Map<string, DimensionRecord[]>()
      const matchingText = byText.get(record.normalizedText)
      if (matchingText) matchingText.push(record)
      else byText.set(record.normalizedText, [record])
      byNode.set(nodeId, byText)
    }
  }

  const issues: DimensionCompletenessIssue[] = []
  for (const [nodeId, byText] of byNode) {
    if (byText.size < 2) continue
    const firstRecord = [...byText.values()][0]?.[0]
    if (!firstRecord) continue
    issues.push({
      id: ['dimension-completeness', 'contradictory-dimension-string', nodeId].join(':'),
      kind: 'contradictory-dimension-string',
      nodeId,
      nodeType: 'unknown',
      severity: 'warning',
      message: `Referenced node ${nodeId} has contradictory construction dimension strings: ${[
        ...byText.keys(),
      ].join(', ')}.`,
    })
  }
  return issues
}

function segmentTotalMismatchIssues(
  records: readonly DimensionRecord[],
  tolerance: number,
): DimensionCompletenessIssue[] {
  return records.flatMap((record) => {
    if (record.dimension.chainMode !== 'continuous') return []
    if (record.parsedTextValue === null || record.segmentTotal === null) return []
    if (Math.abs(record.parsedTextValue - record.segmentTotal) <= tolerance) return []

    return [
      issue(
        'dimension-segment-total-mismatch',
        record.dimension,
        'warning',
        `Continuous dimension ${record.dimension.id} text ${record.normalizedText} does not match its segment total ${record.segmentTotal.toFixed(3)}m.`,
      ),
    ]
  })
}

function preflightCompletenessIssues(
  preflightIssues: readonly DimensionCompletenessPreflightIssue[],
): DimensionCompletenessIssue[] {
  const issues: DimensionCompletenessIssue[] = []
  for (const preflightIssue of preflightIssues) {
    const normalizedKind = preflightIssue.kind?.trim().toLowerCase()
    const normalizedMessage = preflightIssue.message.trim().toLowerCase()

    if (normalizedKind === 'unresolved-collision') {
      issues.push(
        preflightIssueCompletenessIssue(
          'unresolved-annotation-collision',
          preflightIssue,
          'annotation',
        ),
      )
      continue
    }

    if (
      normalizedKind === 'clipped-content' ||
      normalizedKind === 'clipped-sheet-content' ||
      normalizedMessage.includes('clipped') ||
      normalizedMessage.includes('exceeds the sheet viewport')
    ) {
      issues.push(preflightIssueCompletenessIssue('clipped-sheet-content', preflightIssue, 'sheet'))
    }
  }
  return issues
}

function preflightIssueCompletenessIssue(
  kind: Extract<
    DimensionCompletenessIssueKind,
    'unresolved-annotation-collision' | 'clipped-sheet-content'
  >,
  preflightIssue: DimensionCompletenessPreflightIssue,
  fallbackNodeId: string,
): DimensionCompletenessIssue {
  const nodeId = preflightIssue.id?.trim() || fallbackNodeId
  return {
    id: ['dimension-completeness', kind, nodeId].join(':'),
    kind,
    nodeId,
    nodeType: fallbackNodeId,
    severity: preflightIssue.severity ?? 'warning',
    message: preflightIssue.message,
  }
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

function hasDocumentationCoverage(node: AnyNode, coverage: DocumentationCoverage): boolean {
  return coverage.dimensioned.has(node.id) || coverage.scheduled.has(node.id)
}

function hasGeneratedScheduleEntry(node: AnyNode): boolean {
  if (node.type === 'door' || node.type === 'window') return node.openingKind !== 'opening'
  return node.type === 'zone' && node.spaceRole === 'room'
}

function isConstructionCriticalNode(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  if (node.type === 'wall') return isExteriorWall(node) || isPartitionWall(node)
  if (node.type === 'door' || node.type === 'window') {
    const hostWall = openingHostWall(node, nodes)
    return hostWall ? isExteriorWall(hostWall) : false
  }
  if (node.type === 'zone') return node.spaceRole === 'room'
  return (
    node.type === 'cabinet' ||
    node.type === 'cabinet-module' ||
    node.type === 'stair' ||
    node.type === 'stair-segment'
  )
}

function normalizedDimensionText(text: string | null): string | null {
  const normalized = text
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s+(MM|M|")/gi, '$1$2')
    .toUpperCase()
  return normalized || null
}

function parseDimensionTextValue(text: string): number | null {
  const metricMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(MM|M)?$/)
  if (metricMatch) {
    const value = Number.parseFloat(metricMatch[1] ?? '')
    if (!Number.isFinite(value)) return null
    return metricMatch[2] === 'MM' ? value / 1000 : value
  }

  const imperialMatch = text.match(/^(?:(\d+(?:\.\d+)?)')?(?:-)?(?:(\d+(?:\.\d+)?)")?$/)
  if (imperialMatch) {
    const feet = Number.parseFloat(imperialMatch[1] ?? '0')
    const inches = Number.parseFloat(imperialMatch[2] ?? '0')
    const totalInches = feet * 12 + inches
    return totalInches > 0 ? totalInches * 0.0254 : null
  }

  return null
}

function continuousSegmentTotal(dimension: ConstructionDimensionNode): number | null {
  if (dimension.chainMode !== 'continuous' || dimension.anchors.length < 3) return null

  const directionLength = Math.hypot(
    dimension.baseline.direction[0],
    dimension.baseline.direction[1],
  )
  if (directionLength <= 1e-9) return null
  const dirX = dimension.baseline.direction[0] / directionLength
  const dirZ = dimension.baseline.direction[1] / directionLength

  let total = 0
  for (let index = 1; index < dimension.anchors.length; index += 1) {
    const previousAnchor = dimension.anchors[index - 1]
    const currentAnchor = dimension.anchors[index]
    if (!previousAnchor || !currentAnchor) return null
    const previous = anchorFallbackPoint(previousAnchor)
    const current = anchorFallbackPoint(currentAnchor)
    total += Math.abs((current[0] - previous[0]) * dirX + (current[2] - previous[2]) * dirZ)
  }
  return total
}

function anchorFallbackPoint(
  anchor: ConstructionDimensionNode['anchors'][number],
): [number, number, number] {
  return Array.isArray(anchor) ? anchor : anchor.fallback
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
