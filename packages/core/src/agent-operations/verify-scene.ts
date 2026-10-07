import { levelBuildingId } from '../building/level-duplication'
import { getLevelDisplayName } from '../lib/level-name'
import { detectOpenWallEnds, type OpenWallEnd } from '../lib/room-graph'
import { type AnyNode, type AnyNodeId, AnyNode as AnyNodeSchema } from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { computeSegmentTransforms, rotateXZ } from '../systems/stair/stair-footprint'
import { resolveStairTotalRise } from '../systems/stair/stair-rise-query'
import { measureStair } from '../systems/stair/stair-sizing'
import { checkOpeningWithinWall, formatOpeningBoundsIssue } from '../validation/opening-bounds'
import { layoutIssuesFromScene } from './layout-clearance'
import { wallResolvedHeight } from './level-reads'
import { pointInPolygon, polygonContainsPolygon, type Vec2 } from './plan-geometry'
import { changesSince, type SceneCheckpoint } from './scene-measure'
import {
  type ContentCounts,
  contentCounts,
  levelIdOf,
  levelRole,
  levelsOf,
  nodesOnLevel,
} from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

/** A problem verify_scene found, typed so it can be counted and acted on. */
export type SceneIssue =
  | { type: string; message: string; severity?: 'info' }
  | {
      type: 'wall_open_end'
      message: string
      severity?: 'info'
      wallId: string
      end: OpenWallEnd['end']
      reason: Exclude<OpenWallEnd['reason'], 'isolated'>
      gap?: number
      nearestWallId?: string
    }

/** What verify_scene was asked: its contract's input, which other modules may extend. */
export type VerifySceneInput = Readonly<Record<string, unknown>>

/**
 * A check verify_scene runs beyond its own, registered by the module that knows it (the facade
 * checks, the photo's), so verify_scene imports none of them. Checks before CHECKPOINT_ORDER run
 * ahead of the checkpoint's comparison, the rest after it.
 */
export type SceneCheck = {
  name: string
  order: number
  run: (nodes: SceneNodes, input: VerifySceneInput) => SceneIssue[]
}

export const CHECKPOINT_ORDER = 100

const checks: SceneCheck[] = []

/**
 * Fields verify_scene's result carries beyond its own, from the module that knows them (the
 * reference inventory's counts and what is unbuilt).
 */
export type SceneReport = { name: string; run: (nodes: SceneNodes) => Record<string, unknown> }

const reports: SceneReport[] = []

/** Adds a report's fields to every verify_scene from now on; registering again replaces it. */
export function registerSceneReport(report: SceneReport) {
  const at = reports.findIndex((known) => known.name === report.name)
  if (at >= 0) reports[at] = report
  else reports.push(report)
}

/** Runs a check in every verify_scene from now on; registering a check again replaces it. */
export function registerSceneCheck(check: SceneCheck) {
  const at = checks.findIndex((known) => known.name === check.name)
  if (at >= 0) checks[at] = check
  else checks.push(check)
  checks.sort((a, b) => a.order - b.order)
}

type StairNode = AnyNode & { type: 'stair' }
const occupiedContent = (counts: ContentCounts) =>
  counts.walls +
  counts.zones +
  counts.doors +
  counts.windows +
  counts.items +
  counts.slabs +
  counts.ceilings +
  counts.stairs

function toWorldPlanPoint(stair: StairNode, localX: number, localZ: number): Vec2 {
  const [worldX, worldZ] = rotateXZ(localX, localZ, stair.rotation ?? 0)
  return [stair.position[0] + worldX, stair.position[2] + worldZ]
}

function stairFootprintPolygons(nodes: SceneNodes, stair: StairNode): Vec2[][] {
  if (stair.stairType === 'curved' || stair.stairType === 'spiral') {
    const radius = Math.max(0.05, stair.innerRadius ?? 0.9) + Math.max(stair.width ?? 1, 0.4)
    return [
      Array.from({ length: 24 }).map((_, index) => {
        const angle = (index / 24) * Math.PI * 2
        return toWorldPlanPoint(stair, Math.cos(angle) * radius, Math.sin(angle) * radius)
      }),
    ]
  }

  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is AnyNode & { type: 'stair-segment' } => node?.type === 'stair-segment')
  const usableSegments =
    segments.length > 0
      ? segments
      : [
          {
            width: stair.width ?? 1,
            length: 3,
            height: resolveStairTotalRise(stair, nodes as Record<string, AnyNode>),
            stepCount: stair.stepCount ?? 10,
            attachmentSide: 'front' as const,
          },
        ]
  const transforms = computeSegmentTransforms(usableSegments)

  return usableSegments.map((segment, index) => {
    const transform = transforms[index] ?? {
      position: [0, 0, 0] as [number, number, number],
      rotation: 0,
    }
    const halfWidth = segment.width / 2
    const corners: Vec2[] = [
      [-halfWidth, 0],
      [halfWidth, 0],
      [halfWidth, segment.length],
      [-halfWidth, segment.length],
    ]
    return corners.map(([localX, localZ]) => {
      const [rx, rz] = rotateXZ(localX, localZ, transform.rotation)
      return toWorldPlanPoint(stair, transform.position[0] + rx, transform.position[2] + rz)
    })
  })
}

function wallSamplePoints(wall: AnyNode & { type: 'wall' }): Vec2[] {
  return [0.25, 0.5, 0.75].map((t) => [
    wall.start[0] + (wall.end[0] - wall.start[0]) * t,
    wall.start[1] + (wall.end[1] - wall.start[1]) * t,
  ])
}

function levelNumber(nodes: SceneNodes, levelId: string | null | undefined) {
  const node = levelId ? nodes[levelId] : undefined
  return node?.type === 'level' ? node.level : undefined
}

function targetLevelIdsForStair(nodes: SceneNodes, stair: StairNode): string[] {
  const fromLevelId = stair.fromLevelId ?? levelIdOf(nodes, stair.id)
  const toLevelId = stair.toLevelId ?? fromLevelId
  const fromLevel = levelNumber(nodes, fromLevelId)
  const toLevel = levelNumber(nodes, toLevelId)
  if (fromLevel === undefined || toLevel === undefined) return toLevelId ? [toLevelId] : []
  const low = Math.min(fromLevel, toLevel)
  const high = Math.max(fromLevel, toLevel)
  const fromLevelNode = fromLevelId ? nodes[fromLevelId] : undefined
  const buildingId =
    fromLevelNode?.type === 'level'
      ? levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, fromLevelNode)
      : null
  return levelsOf(nodes)
    .filter((level) => level.level > low && level.level <= high)
    .filter(
      (level) =>
        !buildingId || levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, level) === buildingId,
    )
    .map((level) => level.id)
}

function holeBelongsToStair(
  surface: AnyNode & { type: 'slab' | 'ceiling' },
  holeIndex: number,
  stairId: string,
) {
  const metadata = surface.holeMetadata?.[holeIndex]
  return metadata?.source === 'stair' && metadata.stairId === stairId
}

function parentListsChild(parent: AnyNode, childId: string): boolean {
  if (!('children' in parent && Array.isArray(parent.children))) return false
  return parent.children.some((child) => {
    if (typeof child === 'string') return child === childId
    return (
      child !== null &&
      typeof child === 'object' &&
      'id' in child &&
      (child as { id?: unknown }).id === childId
    )
  })
}

function schemaErrors(nodes: SceneNodes) {
  const errors: { nodeId: string; path: string; message: string }[] = []
  for (const [id, node] of Object.entries(nodes)) {
    const parsed = AnyNodeSchema.safeParse(node)
    if (parsed.success) continue
    for (const issue of parsed.error.issues)
      errors.push({ nodeId: id, path: issue.path.join('.'), message: issue.message })
  }
  return errors
}

/**
 * `verify_scene`: a self-check after complex edits. Per-level content and roles, then every
 * practical problem found, typed: rooms missing floors or ceilings, roof levels misused, storeys
 * with no stair, openings off their wall, stairs off their slab, blocked doors, overlapping
 * furniture, nodes their schema rejects.
 */
export const verifyScene: AgentOperation<VerifySceneInput | undefined> = (
  nodes,
  input,
  context,
) => {
  const onLevel = (levelId: string) => nodesOnLevel(nodes, levelId)
  const ofType = <T extends AnyNode['type']>(content: readonly AnyNode[], type: T) =>
    content.filter((node): node is Extract<AnyNode, { type: T }> => node.type === type)

  const levels = levelsOf(nodes).map((level) => {
    const content = contentCounts(onLevel(level.id))
    const { role, metadataRole, referenceLevelId } = levelRole(nodes, level)
    return {
      levelId: level.id,
      levelName: getLevelDisplayName(level),
      floorIndex: level.level,
      role,
      metadataRole,
      isOccupiedStory: role === 'occupied',
      isSupportLevel: role !== 'occupied',
      referenceLevelId,
      isActive: level.id === context.activeLevelId,
      isEmpty: Object.values(content).every((count) => count === 0),
      content,
    }
  })

  const issues: SceneIssue[] = []
  const report = (type: string, message: string, informational = false) =>
    issues.push({ type, message, ...(informational ? { severity: 'info' as const } : {}) })

  const empty = levels.filter((level) => level.isEmpty)
  if (empty.length > 0)
    report(
      'empty_levels',
      `${empty.length} empty level(s): ${empty.map((level) => `${level.levelName} (${level.levelId})`).join(', ')}`,
    )

  for (const level of levels) {
    const { content, levelName } = level
    // A free-standing wall (garden wall, half wall) is legitimate, not something to repair.
    for (const end of detectOpenWallEnds(nodes, level.levelId)) {
      if (end.reason === 'isolated') continue
      issues.push({
        type: 'wall_open_end',
        message: `Wall ${end.wallId} ${end.end} is open on ${levelName}: ${end.reason}${end.candidate ? `; nearest wall ${end.candidate.wallId}` : ''}`,
        wallId: end.wallId,
        end: end.end,
        reason: end.reason,
        ...(end.gap !== undefined ? { gap: end.gap } : {}),
        ...(end.candidate ? { nearestWallId: end.candidate.wallId } : {}),
      })
    }
    if (level.role === 'roof') {
      if (content.roofs === 0)
        report(
          'roof_level_no_roof',
          `${levelName} is a roof support level but has no roof geometry; add or move roof geometry there rather than deleting the support level to satisfy story count`,
        )
      if (occupiedContent(content) > 0)
        report(
          'roof_level_occupied',
          `${levelName} is a roof support level but contains occupied-story content; move rooms, walls, stairs, slabs, ceilings, and items to an occupied story and keep the roof level for roof geometry only`,
        )
      const reference = level.referenceLevelId ? nodes[level.referenceLevelId] : undefined
      if (reference?.type === 'level' && level.floorIndex <= reference.level)
        report(
          'roof_level_below_reference',
          `${levelName} roof support level should be above its reference occupied level ${reference.name ?? reference.id}`,
        )
      continue
    }
    if (content.walls > 0 && content.zones === 0)
      report('walls_no_zones', `${levelName} has walls but no zones/rooms`)
    if (content.zones > 0 && content.slabs === 0)
      report('zones_no_slabs', `${levelName} has zones but no slabs/floors`)
    if (content.zones > 0 && content.ceilings === 0)
      report('zones_no_ceilings', `${levelName} has zones but no ceilings`)
    if (content.walls > 0 && content.doors === 0)
      report('walls_no_doors', `${levelName} has walls but no doors`)
    if (content.roofs > 0 && (content.walls > 0 || content.zones > 0 || content.stairs > 0))
      report(
        'roof_mixed_in_storey',
        `${levelName} mixes roof geometry with occupied-level content; place roofs on a dedicated roof level for solo/exploded level views`,
      )
  }

  // Storeys are counted per building: separate buildings need no stair between them, and a wall
  // can only span the storeys of its own building.
  const storeysByBuilding = new Map<string, typeof levels>()
  for (const level of levels) {
    if (!level.isOccupiedStory) continue
    const node = nodes[level.levelId] as AnyNode & { type: 'level' }
    const buildingId = levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, node) ?? ''
    storeysByBuilding.set(buildingId, [...(storeysByBuilding.get(buildingId) ?? []), level])
  }
  for (const [buildingId, storeys] of storeysByBuilding) {
    if (storeys.length < 2) continue
    const stairs = levels
      .filter((level) => {
        const node = nodes[level.levelId] as AnyNode & { type: 'level' }
        return (levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, node) ?? '') === buildingId
      })
      .reduce((sum, level) => sum + level.content.stairs, 0)
    if (stairs === 0)
      report(
        'missing_stair',
        `${nodes[buildingId]?.name ?? 'The building'} has ${storeys.length} storeys and no stair: add one on the ground floor, in the hall or entry, to connect them.`,
      )
  }

  for (const storeys of storeysByBuilding.values()) {
    if (storeys.length < 2) continue
    for (const level of storeys) {
      const node = nodes[level.levelId] as AnyNode & { type: 'level' }
      const expectedHeight = getStoredLevelHeight(node)
      for (const wall of ofType(onLevel(level.levelId), 'wall')) {
        const wallHeight = wallResolvedHeight(nodes, wall)
        if (wallHeight > expectedHeight + 0.25)
          report(
            'wall_spans_storeys',
            `Wall ${wall.name ?? wall.id} on ${node.name ?? node.id} is ${wallHeight}m high; multi-story exterior walls should be split into level-owned story walls`,
          )
      }
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type !== 'door' && node.type !== 'window') continue
    const parent = node.parentId ? nodes[node.parentId] : undefined
    if (parent?.type !== 'wall') {
      report('opening_not_on_wall', `${node.type} ${node.id} is not parented to a wall`)
      continue
    }
    if (node.wallId !== parent.id)
      report(
        'opening_wall_mismatch',
        `${node.type} ${node.id} has wallId ${node.wallId ?? 'unset'} but is parented to wall ${parent.id}`,
      )
    if (!parentListsChild(parent, node.id))
      report(
        'opening_not_listed',
        `${node.type} ${node.id} is not listed in wall ${parent.id} children`,
      )
    for (const issue of checkOpeningWithinWall(node, parent, wallResolvedHeight(nodes, parent)))
      report(
        issue.kind === 'along_wall' ? 'opening_outside_wall' : 'opening_outside_height',
        formatOpeningBoundsIssue(issue),
      )
  }

  for (const stair of Object.values(nodes).filter(
    (node): node is StairNode => node.type === 'stair',
  )) {
    const stairName = stair.name ?? stair.id
    for (const diagnostic of measureStair(stair, nodes as Record<string, AnyNode>).diagnostics)
      report(
        `stair_${diagnostic.code.replaceAll('-', '_')}`,
        `Stair ${stairName}: ${diagnostic.message}`,
        diagnostic.code.endsWith('-target'),
      )
    const sourceLevelId = levelIdOf(nodes, stair.id)
    if (sourceLevelId) {
      const sourceName = nodes[sourceLevelId]?.name ?? sourceLevelId
      const footprints = stairFootprintPolygons(nodes, stair)
      const sourceSlabs = ofType(onLevel(sourceLevelId), 'slab')
      if (
        sourceSlabs.length > 0 &&
        footprints.some(
          (footprint) =>
            !sourceSlabs.some((slab) => polygonContainsPolygon(slab.polygon as Vec2[], footprint)),
        )
      )
        report(
          'stair_outside_slab',
          `Stair ${stairName} footprint extends outside source floor slab on ${sourceName}`,
        )
      for (const wall of ofType(onLevel(sourceLevelId), 'wall'))
        if (
          footprints.some((footprint) =>
            wallSamplePoints(wall).some((point) => pointInPolygon(point, footprint, false)),
          )
        )
          report(
            'stair_obstructed',
            `Wall ${wall.name ?? wall.id} obstructs stair ${stairName} on ${sourceName}`,
          )
    }

    if ((stair.slabOpeningMode ?? 'none') !== 'destination') continue
    const targetLevelIds = targetLevelIdsForStair(nodes, stair)
    if (targetLevelIds.length === 0)
      report(
        'stair_opening_no_target',
        `Stair ${stairName} requests a slab opening but has no target level`,
      )
    for (const targetLevelId of targetLevelIds) {
      const targetName = nodes[targetLevelId]?.name ?? targetLevelId
      const targetSlabs = ofType(onLevel(targetLevelId), 'slab')
      if (targetSlabs.length === 0) {
        report(
          'stair_target_no_slab',
          `Stair ${stairName} targets ${targetName} but it has no slab`,
        )
        continue
      }
      const holes = targetSlabs.flatMap((slab) =>
        (slab.holes ?? [])
          .map((hole, index) => ({ slab, hole, index }))
          .filter((entry) => holeBelongsToStair(entry.slab, entry.index, stair.id)),
      )
      // Since owned floor openings, the stair owns a floor-opening on the floor above, and the
      // slab hole it cuts names the opening, not the stair (else 14 false reports on one build).
      const owned = onLevel(targetLevelId).filter(
        (node): node is AnyNode & { type: 'floor-opening' } =>
          node.type === 'floor-opening' &&
          node.source === 'stair' &&
          node.ownerId === stair.id &&
          node.drawnOn === 'floor',
      )
      for (const opening of owned) {
        const slab =
          targetSlabs.find((candidate) => candidate.id === opening.surfaceId) ?? targetSlabs[0]!
        holes.push({ slab, hole: opening.polygon, index: -1 })
      }
      if (holes.length === 0) {
        report(
          'stair_no_opening',
          `Stair ${stairName} has no destination slab opening on ${targetName}`,
        )
        continue
      }
      for (const { slab, hole } of holes)
        if (!polygonContainsPolygon(slab.polygon as Vec2[], hole as Vec2[]))
          report(
            'stair_opening_outside_slab',
            `Stair ${stairName} opening extends outside slab ${slab.name ?? slab.id}`,
          )
    }
  }

  const errors = schemaErrors(nodes)
  for (const error of errors.slice(0, 5))
    report('schema_invalid', `Schema: ${error.nodeId}.${error.path} ${error.message}`)
  if (errors.length > 5)
    report('schema_invalid', `Schema: ${errors.length - 5} additional validation errors`)

  // Door keep-outs and item–item footprint overlaps (rotation-aware).
  issues.push(...layoutIssuesFromScene(Object.values(nodes)))
  for (const check of checks)
    if (check.order < CHECKPOINT_ORDER) issues.push(...check.run(nodes, input ?? {}))
  // What the edits since the host's checkpoint lost, by place.
  const since = context.checkpoint
    ? changesSince(context.checkpoint as SceneCheckpoint, nodes)
    : null
  if (since) issues.push(...since.issues)
  for (const check of checks)
    if (check.order >= CHECKPOINT_ORDER) issues.push(...check.run(nodes, input ?? {}))

  const occupiedStoryCount = levels.filter((level) => level.isOccupiedStory).length
  return {
    result: {
      ok: true,
      valid: errors.length === 0,
      levelCount: levels.length,
      occupiedStoryCount,
      supportLevelCount: levels.length - occupiedStoryCount,
      roofLevelIds: levels.filter((level) => level.role === 'roof').map((level) => level.levelId),
      activeLevelId: context.activeLevelId,
      levels,
      emptyLevelIds: empty.map((level) => level.levelId),
      issues,
      hasIssues: issues.some((issue) => issue.severity !== 'info'),
      ...authoredObjects(nodes),
      ...Object.assign({}, ...reports.map((report) => report.run(nodes))),
      ...(since && {
        sinceCheckpoint: { name: context.checkpoint!.name, changes: since.changes },
      }),
    },
  }
}

/** Objects built by add_object, with what each stands in for: each is a gap in what Pascal builds. */
function authoredObjects(nodes: SceneNodes) {
  const objects = Object.values(nodes)
    .flatMap((node) =>
      node.type === 'item' && node.source
        ? [
            {
              id: node.id,
              name: node.name ?? node.asset.name,
              category: node.asset.category,
              reason: typeof node.metadata?.reason === 'string' ? node.metadata.reason : null,
            },
          ]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return objects.length ? { authoredObjects: objects } : {}
}
