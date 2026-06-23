import fs from 'node:fs'
import path from 'node:path'
import type { AnyNode } from '@pascal-app/core/schema'
import type { FactoryPlan } from './factory-planner'
import type { FactoryMissingAsset, FactoryScenePatch } from './factory-runner'
import {
  type ProcessRouteObstacle,
  type ProcessRoutePoint,
  routeSegmentIntersectsClearanceBox,
} from './process-line-routing'
import type { ProcessConnectionPlan, ProcessStationPlan } from './process-line-types'

export type FactoryQualitySeverity = 'error' | 'warning' | 'info'

export type FactoryQualityIssue = {
  code: string
  severity: FactoryQualitySeverity
  message: string
  stationId?: string
  connectionIndex?: number
  nodeId?: string
  assetUrl?: string
}

export type FactoryQualityReport = {
  score: number
  passed: boolean
  summary: string
  issueCount: {
    error: number
    warning: number
    info: number
  }
  checks: {
    patchCount: number
    createdNodeCount: number
    expectedStationCount?: number
    stationEquipmentCount?: number
    connectionCount?: number
    routedConnectionCount?: number
    primitiveQualityCount: number
    catalogItemCount: number
    localAssetCount: number
    missingAssetCount: number
    duplicateNodeIdCount: number
    routeCollisionCount: number
  }
  issues: FactoryQualityIssue[]
}

type QualityResultInput = {
  intent?: { action?: string; prompt?: string }
  plan?: FactoryPlan
  patches: FactoryScenePatch[]
  nodeIds?: string[]
  missingAssets: FactoryMissingAsset[]
  layoutDiagnostics?: {
    fits?: boolean
    diagnostics?: Array<{ code?: string; message?: string; severity?: string }>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createNode(patch: FactoryScenePatch): AnyNode | undefined {
  return patch.op === 'create' ? patch.node : undefined
}

function nodeMetadata(node: AnyNode | undefined): Record<string, unknown> {
  return isRecord(node?.metadata) ? node.metadata : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function routePointValue(value: unknown): ProcessRoutePoint | undefined {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [value[0], value[1]]
    : undefined
}

function findRepoRootSync(start = process.cwd()) {
  let current = path.resolve(start)
  for (let i = 0; i < 8; i += 1) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'apps', 'editor', 'public'))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.resolve(start)
}

function hostedAssetPathExists(assetUrl: string) {
  if (assetUrl.startsWith('asset://')) return true
  const cleanPath = assetUrl.split('?')[0]?.split('#')[0] ?? ''
  if (!cleanPath || cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
    return true
  }
  const normalized = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) return false
  return fs.existsSync(path.join(findRepoRootSync(), 'apps', 'editor', 'public', normalized))
}

function issue(
  issues: FactoryQualityIssue[],
  severity: FactoryQualitySeverity,
  code: string,
  message: string,
  extra: Omit<FactoryQualityIssue, 'severity' | 'code' | 'message'> = {},
) {
  issues.push({ severity, code, message, ...extra })
}

function processPlan(plan: FactoryPlan | undefined) {
  return plan?.kind === 'process_line' ? plan.process : undefined
}

function stationHasEquipment(patches: FactoryScenePatch[], station: ProcessStationPlan) {
  return patches.some((patch) => {
    const node = createNode(patch)
    if (!node) return false
    const metadata = nodeMetadata(node)
    if (metadata.stationId !== station.id) return false
    if (node.type === 'zone' && metadata.role === 'process-line-station') return false
    return true
  })
}

function routeExistsForConnection(patches: FactoryScenePatch[], connection: ProcessConnectionPlan) {
  return patches.some((patch) => {
    const node = createNode(patch)
    if (!node) return false
    const metadata = nodeMetadata(node)
    if (
      metadata.role === 'process-line-connection' &&
      metadata.fromStationId === connection.fromStationId &&
      metadata.toStationId === connection.toStationId &&
      metadata.visualKind === connection.visualKind
    ) {
      return true
    }
    return routeConnectionLegs(metadata).some((leg) => connectionMatchesLeg(connection, leg))
  })
}

function connectionHasPortAlignment(
  patches: FactoryScenePatch[],
  connection: ProcessConnectionPlan,
  portSide: 'from' | 'to',
) {
  const expected = portSide === 'from' ? connection.fromPortId : connection.toPortId
  if (!expected) return true
  const metadataKey = portSide === 'from' ? 'fromPortId' : 'toPortId'
  return patches.some((patch) => {
    const node = createNode(patch)
    if (!node) return false
    const metadata = nodeMetadata(node)
    if (
      metadata.role === 'process-line-connection' &&
      metadata.fromStationId === connection.fromStationId &&
      metadata.toStationId === connection.toStationId &&
      metadata[metadataKey] === expected
    ) {
      return true
    }
    return routeConnectionLegs(metadata).some(
      (leg) => connectionMatchesLeg(connection, leg) && leg[metadataKey] === expected,
    )
  })
}

function routeConnectionLegs(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.routeConnectionLegs)
    ? metadata.routeConnectionLegs.filter(isRecord)
    : []
}

function connectionMatchesLeg(connection: ProcessConnectionPlan, leg: Record<string, unknown>) {
  return (
    leg.fromStationId === connection.fromStationId &&
    leg.toStationId === connection.toStationId &&
    leg.visualKind === connection.visualKind
  )
}

function summarizeScore(score: number, errors: number, warnings: number) {
  if (errors > 0 || score < 70) return `Factory quality needs review (${score}/100).`
  if (warnings > 0) return `Factory quality passed with warnings (${score}/100).`
  return `Factory quality passed (${score}/100).`
}

function routeObstacleFromMetadata(
  metadata: Record<string, unknown>,
): ProcessRouteObstacle | undefined {
  const value = metadata.factoryRouteObstacle ?? metadata.factoryPrimitiveRouteObstacle
  if (!isRecord(value) || !isRecord(value.box)) return undefined
  const stationId = stringValue(value.stationId)
  const minX = numberValue(value.box.minX)
  const maxX = numberValue(value.box.maxX)
  const minZ = numberValue(value.box.minZ)
  const maxZ = numberValue(value.box.maxZ)
  if (!stationId || minX == null || maxX == null || minZ == null || maxZ == null) return undefined
  return {
    stationId,
    source:
      value.source === 'artifact' ||
      value.source === 'layout' ||
      value.source === 'native' ||
      value.source === 'catalog' ||
      value.source === 'profile-parts'
        ? value.source
        : undefined,
    minHeight: numberValue(value.minHeight),
    maxHeight: numberValue(value.maxHeight),
    box: { minX, maxX, minZ, maxZ },
  } satisfies ProcessRouteObstacle
}

function routeSegmentFromNode(node: AnyNode) {
  if (node.type !== 'pipe' && node.type !== 'cable-tray') return undefined
  const record = node as unknown as Record<string, unknown>
  const start = routePointValue(record.start)
  const end = routePointValue(record.end)
  if (!start || !end) return undefined
  return {
    start,
    end,
    elevation: numberValue(record.elevation),
    metadata: nodeMetadata(node),
  }
}

function elevationOverlapsObstacle(elevation: number | undefined, obstacle: ProcessRouteObstacle) {
  if (elevation == null) return true
  if (obstacle.minHeight == null || obstacle.maxHeight == null) return true
  return elevation >= obstacle.minHeight && elevation <= obstacle.maxHeight
}

export function evaluateFactoryQuality(input: QualityResultInput): FactoryQualityReport {
  const issues: FactoryQualityIssue[] = []
  const createPatches = input.patches.filter((patch) => patch.op === 'create')
  const createdIds = new Set<string>()
  let duplicateNodeIdCount = 0
  let primitiveQualityCount = 0
  let catalogItemCount = 0
  let localAssetCount = 0
  let routeCollisionCount = 0

  for (const patch of createPatches) {
    const node = createNode(patch)
    if (!node) continue
    if (createdIds.has(node.id)) {
      duplicateNodeIdCount += 1
      issue(issues, 'error', 'duplicate_node_id', `Duplicate generated node id: ${node.id}.`, {
        nodeId: node.id,
      })
    }
    createdIds.add(node.id)

    const metadata = nodeMetadata(node)
    const primitiveQuality = metadata.factoryPrimitiveQuality
    if (isRecord(primitiveQuality)) {
      primitiveQualityCount += 1
      if (primitiveQuality.passed !== true) {
        issue(
          issues,
          'error',
          'primitive_quality_failed',
          `Primitive equipment quality gate failed for ${node.name}.`,
          { nodeId: node.id, stationId: stringValue(metadata.stationId) },
        )
      }
    }

    if (node.type === 'item') {
      catalogItemCount += 1
      const asset = isRecord(node.asset) ? node.asset : undefined
      const assetSrc = stringValue(asset?.src)
      if (!assetSrc) {
        issue(
          issues,
          'error',
          'catalog_asset_missing_src',
          `Catalog item ${node.name} has no src.`,
          {
            nodeId: node.id,
          },
        )
        continue
      }
      if (assetSrc.startsWith('http://') || assetSrc.startsWith('https://')) {
        issue(
          issues,
          'warning',
          'catalog_asset_external_url',
          `Catalog item ${node.name} depends on an external asset URL.`,
          { nodeId: node.id, assetUrl: assetSrc },
        )
      } else if (!hostedAssetPathExists(assetSrc)) {
        issue(
          issues,
          'error',
          'catalog_asset_not_found',
          `Catalog item ${node.name} points to a missing hosted asset.`,
          { nodeId: node.id, assetUrl: assetSrc },
        )
      } else {
        localAssetCount += 1
      }
    }
  }

  const routeObstacles = createPatches
    .map((patch) => routeObstacleFromMetadata(nodeMetadata(createNode(patch))))
    .filter((obstacle): obstacle is ProcessRouteObstacle => Boolean(obstacle))
  const routeSegments = createPatches
    .map((patch) => {
      const node = createNode(patch)
      return node ? { node, segment: routeSegmentFromNode(node) } : undefined
    })
    .filter(
      (
        entry,
      ): entry is {
        node: AnyNode
        segment: NonNullable<ReturnType<typeof routeSegmentFromNode>>
      } => Boolean(entry?.segment),
    )

  for (const { node, segment } of routeSegments) {
    const fromStationId = stringValue(segment.metadata.fromStationId)
    const toStationId = stringValue(segment.metadata.toStationId)
    for (const obstacle of routeObstacles) {
      if (obstacle.stationId === fromStationId || obstacle.stationId === toStationId) continue
      if (!elevationOverlapsObstacle(segment.elevation, obstacle)) continue
      if (!routeSegmentIntersectsClearanceBox(segment.start, segment.end, obstacle.box)) continue
      routeCollisionCount += 1
      issue(
        issues,
        'error',
        'process_route_intersects_equipment',
        `Route ${node.name} intersects generated equipment obstacle ${obstacle.stationId}.`,
        {
          nodeId: node.id,
          stationId: obstacle.stationId,
        },
      )
    }
  }

  for (const missing of input.missingAssets) {
    issue(
      issues,
      missing.required ? 'error' : 'warning',
      missing.required ? 'required_asset_missing' : 'optional_asset_missing',
      `${missing.name}: ${missing.reason}`,
    )
  }

  if (input.layoutDiagnostics) {
    if (input.layoutDiagnostics.fits === false) {
      issue(issues, 'error', 'layout_does_not_fit', 'Generated process layout does not fit.')
    }
    for (const diagnostic of input.layoutDiagnostics.diagnostics ?? []) {
      issue(
        issues,
        diagnostic.severity === 'error'
          ? 'error'
          : diagnostic.severity === 'warning'
            ? 'warning'
            : 'info',
        diagnostic.code ?? 'layout_diagnostic',
        diagnostic.message ?? 'Layout diagnostic.',
      )
    }
  }

  const plan = processPlan(input.plan)
  let stationEquipmentCount: number | undefined
  let routedConnectionCount: number | undefined
  if (plan) {
    stationEquipmentCount = plan.stations.filter((station) =>
      stationHasEquipment(input.patches, station),
    ).length
    for (const station of plan.stations) {
      if (!stationHasEquipment(input.patches, station)) {
        issue(
          issues,
          'warning',
          'station_equipment_unresolved',
          `Station ${station.displayLabel ?? station.label} only has a placeholder zone.`,
          { stationId: station.id },
        )
      }
    }

    routedConnectionCount = plan.connections.filter((connection) =>
      routeExistsForConnection(input.patches, connection),
    ).length
    plan.connections.forEach((connection, connectionIndex) => {
      if (!routeExistsForConnection(input.patches, connection)) {
        issue(
          issues,
          'error',
          'process_connection_missing',
          `Missing route from ${connection.fromStationId} to ${connection.toStationId}.`,
          { connectionIndex },
        )
        return
      }
      if (!connectionHasPortAlignment(input.patches, connection, 'from')) {
        issue(
          issues,
          'warning',
          'connection_from_port_unresolved',
          `Connection ${connectionIndex + 1} did not resolve from-port ${connection.fromPortId}.`,
          { connectionIndex },
        )
      }
      if (!connectionHasPortAlignment(input.patches, connection, 'to')) {
        issue(
          issues,
          'warning',
          'connection_to_port_unresolved',
          `Connection ${connectionIndex + 1} did not resolve to-port ${connection.toPortId}.`,
          { connectionIndex },
        )
      }
    })
  }

  const issueCount = {
    error: issues.filter((item) => item.severity === 'error').length,
    warning: issues.filter((item) => item.severity === 'warning').length,
    info: issues.filter((item) => item.severity === 'info').length,
  }
  const score = Math.max(0, 100 - issueCount.error * 20 - issueCount.warning * 6 - issueCount.info)

  return {
    score,
    passed: issueCount.error === 0 && score >= 70,
    summary: summarizeScore(score, issueCount.error, issueCount.warning),
    issueCount,
    checks: {
      patchCount: input.patches.length,
      createdNodeCount: createdIds.size,
      expectedStationCount: plan?.stations.length,
      stationEquipmentCount,
      connectionCount: plan?.connections.length,
      routedConnectionCount,
      primitiveQualityCount,
      catalogItemCount,
      localAssetCount,
      missingAssetCount: input.missingAssets.length,
      duplicateNodeIdCount,
      routeCollisionCount,
    },
    issues,
  }
}
