import { levelBuildingId } from '../building/level-duplication'
import { levelGradeStanding } from '../lib/grade-standing'
import { groundSeat } from '../lib/ground-seat'
import { getLevelDisplayName } from '../lib/level-name'
import { HIDDEN_SITE_NOTE } from '../lib/node-visibility'
import { wallSupportForNodes } from '../lib/opening-floor-datum'
import { detectOpenWallEnds, type OpenWallEnd } from '../lib/room-graph'
import { siteBrief } from '../lib/site-placement'
import { nodeRegistry } from '../registry'
import {
  type AnyNode,
  type AnyNodeId,
  AnyNode as AnyNodeSchema,
  type BuildingNode,
  type LevelNode,
} from '../schema'
import { nodeSchemaForKind } from '../schema/compiled-node-parsers'
import { isCeilingGeometry } from '../services/roof-level'
import { isRoofOnStoreyWalls } from '../services/roof-move'
import { getStoredLevelHeight, getWallCoveringSlabs, getWallTop } from '../services/storey'
import { getStoreyDatum } from '../services/storey-datum'
import { computeSegmentTransforms, rotateXZ } from '../systems/stair/stair-footprint'
import {
  resolveStairTotalRise,
  stairClimbsToNoStorey,
  stairReachesStoreyAbove,
} from '../systems/stair/stair-rise-query'
import { measureStair } from '../systems/stair/stair-sizing'
import { checkOpeningWithinWall, formatOpeningBoundsIssue } from '../validation/opening-bounds'
import {
  type CeilingObjectObservation,
  ceilingObjectObservations,
} from './ceiling-object-observations'
import { layoutIssuesFromScene } from './layout-clearance'
import { wallResolvedHeight } from './level-reads'
import { pointInPolygon, polygonContainsPolygon, type Vec2 } from './plan-geometry'
import { type RoomFinding, roomFindings } from './room-findings'
import { EMPTY_SESSION } from './scene-checkpoint'
import { changesSince, type SceneCheckpoint } from './scene-measure'
import {
  type ContentCounts,
  contentCounts,
  levelIdOf,
  levelRole,
  levelsOf,
  nodesOnLevel,
  queryNodes,
} from './scene-queries'
import { reviewSince } from './scene-review'
import type { AgentContext, AgentOperation, SceneNodes } from './types'
import { type WallObjectObservation, wallObjectObservations } from './wall-object-observations'

/** A problem verify_scene found, typed so it can be counted and acted on. */
export type SceneIssue =
  | CeilingObjectObservation
  | WallObjectObservation
  | RoomFinding
  | { type: string; message: string; severity?: 'info' }
  | { type: 'schema_invalid'; message: string; nodeId: string; path: string }
  | {
      type: 'schema_unknown_kind'
      message: string
      severity: 'info'
      kind: string
      count: number
      /** The first few of them. */
      nodeIds: string[]
    }
  | { type: 'site_hidden'; message: string; severity: 'info'; nodeId: string }
  | {
      type: 'wall_covering_slab_contact'
      message: string
      severity?: 'info'
      wallId: string
      slabId: string
      levelId: string
      wallTop: number
      slabUnderside: number
      slabTop: number
      penetration: number
      coplanar: boolean
    }
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

/** How many of a kind no schema knows an issue names. */
const UNKNOWN_KIND_IDS = 5

/**
 * A stored node with the fields its schema defaults filled where it lacks them (a level stored with
 * no `children`), else the node itself: a host reads its own state by identity (the editor's
 * rendered-mesh evidence checks the node is the store's current one).
 */
function withDefaults(node: AnyNode, parsed: unknown): AnyNode {
  const stored = node as Record<string, unknown>
  const filled = Object.entries(parsed as Record<string, unknown>).filter(
    ([key, value]) => stored[key] === undefined && value !== undefined,
  )
  return filled.length === 0 ? node : ({ ...node, ...Object.fromEntries(filled) } as AnyNode)
}

/**
 * Every node checked by its kind's schema: the host's where it lends one, else the registered
 * kind's, else core's. The checks that measure read each node with its defaults filled. A node its schema
 * rejects is listed field by field and left `unread`: they could not read it. A node of a kind no
 * schema here knows (a plugin's, where the plugin is not loaded) is counted by kind and kept as
 * stored: the checks never read it.
 */
function checkSchemas(scene: SceneNodes, hostSchema: AgentContext['nodeSchema']) {
  const errors: { nodeId: string; path: string; message: string }[] = []
  const unknownKinds = new Map<string, string[]>()
  const unread = new Set<string>()
  const measured: Record<string, AnyNode> = {}
  for (const [id, node] of Object.entries(scene)) {
    const type = (node as { type?: unknown } | null)?.type
    const schema =
      typeof type === 'string' && type !== ''
        ? (hostSchema?.(type) ?? nodeRegistry.get(type)?.schema ?? nodeSchemaForKind(type))
        : AnyNodeSchema
    if (!schema) {
      unknownKinds.set(String(type), [...(unknownKinds.get(String(type)) ?? []), id])
      measured[id] = node
      continue
    }
    const parsed = schema.safeParse(node)
    if (parsed.success) {
      measured[id] = withDefaults(node, parsed.data)
      continue
    }
    for (const issue of parsed.error.issues)
      errors.push({ nodeId: id, path: issue.path.join('.'), message: issue.message })
    unread.add(id)
  }
  return { errors, unknownKinds, unread, measured }
}

/**
 * `verify_scene`: a self-check after complex edits. Per-level content, roles and enclosed spaces,
 * then every practical problem found, typed: spaces with no room, rooms the walls do not close or
 * with no name, rooms missing floors or ceilings, roof levels misused, storeys with no stair,
 * openings off their wall, stairs off their slab, blocked doors, overlapping furniture, and every
 * field a node's schema rejects, by node and path; a kind no schema here knows, once per kind.
 */
export const verifyScene: AgentOperation<VerifySceneInput | undefined> = (
  scene,
  input,
  context,
) => {
  const { errors, unknownKinds, unread, measured: nodes } = checkSchemas(scene, context.nodeSchema)
  const onLevel = (levelId: string) => nodesOnLevel(nodes, levelId)
  const ofType = <T extends AnyNode['type']>(content: readonly AnyNode[], type: T) =>
    content.filter((node): node is Extract<AnyNode, { type: T }> => node.type === type)
  // A level holding a node its schema rejects is measured once that node is fixed: around it, a
  // room would read open for the wall left out, a door off its wall, a sofa far from any wall. So
  // are its building's stairs, which a level, a slab or a stair left out would change.
  const unreadOn = new Map<string, string[]>()
  const holdingUnread = new Set<string>()
  for (const id of unread) {
    const levelId = levelIdOf(scene, id)
    if (levelId) unreadOn.set(levelId, [...(unreadOn.get(levelId) ?? []), id])
    for (let at = scene[id]?.parentId; at && !holdingUnread.has(at); at = scene[at]?.parentId)
      holdingUnread.add(at)
  }
  // What the checks across levels read: the scene without the levels that wait.
  const settled =
    unreadOn.size === 0
      ? nodes
      : Object.fromEntries(
          // biome-ignore lint/plugin: verify_scene reads the whole scene
          Object.entries(nodes).filter(([id]) => !unreadOn.has(levelIdOf(scene, id) ?? '')),
        )

  // A roof level holds the roof, no rooms.
  const rooms = new Map<string, RoomFinding[]>()
  const levels = levelsOf(nodes).map((level) => {
    const content = contentCounts(onLevel(level.id))
    const { role, metadataRole, referenceLevelId } = levelRole(nodes, level)
    const levelName = getLevelDisplayName(level)
    const found =
      role === 'roof' ? { spaces: 0, issues: [] } : roomFindings(nodes, level.id, levelName)
    rooms.set(level.id, found.issues)
    const unreadIds = unreadOn.get(level.id)
    return {
      levelId: level.id,
      levelName,
      floorIndex: level.level,
      role,
      metadataRole,
      isOccupiedStory: role === 'occupied',
      isSupportLevel: role !== 'occupied',
      referenceLevelId,
      isActive: level.id === context.activeLevelId,
      isEmpty: Object.values(content).every((count) => count === 0),
      content,
      /** The spaces its walls and separators enclose. */
      spaces: found.spaces,
      /** Nodes on it its schema rejects: its counts leave them out, its findings wait for them. */
      ...(unreadIds && { unread: unreadIds }),
    }
  })

  const buildingOf = (levelId: string) =>
    levelBuildingId(
      nodes as Record<AnyNodeId, AnyNode>,
      nodes[levelId] as AnyNode & { type: 'level' },
    )
  const issues: SceneIssue[] = []
  const report = (type: string, message: string, informational = false) =>
    issues.push({ type, message, ...(informational ? { severity: 'info' as const } : {}) })

  const empty = levels.filter((level) => level.isEmpty && !level.unread)
  if (empty.length > 0)
    report(
      'empty_levels',
      `${empty.length} empty level(s): ${empty.map((level) => `${level.levelName} (${level.levelId})`).join(', ')}`,
    )

  for (const level of levels) {
    const { content, levelName } = level
    if (level.unread) continue
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
      // Roof geometry a plugin draws (roof planes) is no `roof` node, and is still the roof.
      if (onLevel(level.levelId).length === 0)
        report(
          'roof_level_no_roof',
          `${levelName} is a roof support level but has no roof geometry; add or move roof geometry there rather than deleting the support level to satisfy story count`,
        )
      const retainedCeilings = onLevel(level.levelId).filter(
        (node) => node.type === 'item' && isCeilingGeometry(node),
      ).length
      if (occupiedContent(content) - retainedCeilings > 0)
        report(
          'roof_level_occupied',
          `${levelName} is a roof support level but contains occupied-story content; move rooms, walls, stairs, slabs, native room ceilings, and ordinary items to an occupied story; roof geometry and classified retained ceiling shells can stay`,
        )
      // An empty storey counts: it is a floor still to be built, and the roof goes above it.
      const storeyAbove = levels.find(
        (other) =>
          other.isOccupiedStory &&
          other.floorIndex > level.floorIndex &&
          buildingOf(other.levelId) === buildingOf(level.levelId),
      )
      if (storeyAbove)
        report(
          'roof_level_not_on_top',
          `${levelName} is a roof level below the storey ${storeyAbove.levelName} (${storeyAbove.levelId}): exploded and solo views show its roof inside the building. A building's roof level stays above its storeys: move the storey under it, or the roof onto the roof level on top.`,
        )
      continue
    }
    // The ground line: a basement the stack stands at grade is drawn over the terrain, not in it.
    const asNodes = nodes as Record<AnyNodeId, AnyNode>
    if (level.floorIndex < 0 && levelGradeStanding(asNodes, level.levelId) === 'at-grade')
      report(
        'basement_at_grade',
        `${levelName} is floor index ${level.floorIndex}, below the ground floor, but its floor stands at grade (${(getStoreyDatum(nodes, level.levelId)?.floorElevation ?? 0).toFixed(2)} m): its walls rise from the terrain instead of standing down in it. set_ground_level on the level that stands at grade (the floor over it) seats the building, and the levels under it read below grade.`,
        true,
      )
    const seat = groundSeat(asNodes, buildingOf(level.levelId) ?? '')
    if (seat?.levelId === level.levelId && seat.explicit && !seat.seated)
      report(
        'ground_level_unseated',
        `${levelName} is the ground floor, but its floor datum stands ${seat.offset.toFixed(2)} m ${seat.offset > 0 ? 'over' : 'under'} grade (${seat.gradeElevation.toFixed(2)} m); a seated ground floor stands between grade and ${seat.aboveGrade} m (the top of the ${seat.foundation.construction.label} foundation) over it. set_ground_level on it seats the building.`,
        true,
      )
    if (content.walls > 0 && content.zones === 0)
      report('walls_no_zones', `${levelName} has walls but no zones/rooms`)
    if (content.zones > 0 && content.slabs === 0)
      report('zones_no_slabs', `${levelName} has zones but no slabs/floors`)
    if (content.zones > 0 && content.ceilings === 0)
      report('zones_no_ceilings', `${levelName} has zones but no ceilings`)
    if (content.walls > 0 && content.doors === 0)
      report('walls_no_doors', `${levelName} has walls but no doors`)
    issues.push(...rooms.get(level.levelId)!)
    // A roof standing on the walls of the storey holding it: the ones move_roofs_to_roof_level
    // takes off. A porch's on its posts, a lower wing's on the walls below, are where they belong.
    const onWalls = (nodes[level.levelId] as LevelNode).children.filter((id) =>
      isRoofOnStoreyWalls(nodes, id),
    )
    if (onWalls.length > 0)
      report(
        'roof_mixed_in_storey',
        `${levelName} mixes roof geometry with occupied-level content; place roofs on a dedicated roof level for solo/exploded level views. On its own walls: ${onWalls.join(', ')}; move_roofs_to_roof_level with levelId ${level.levelId} moves them there as they stand (never delete and rebuild them); by hand, "Move to the roof level" on the roof's panel`,
      )
  }

  for (const level of levels) {
    for (const wall of ofType(onLevel(level.levelId), 'wall')) {
      const base = wallSupportForNodes(wall, nodes).elevation
      const wallTop = getWallTop(wall, level.levelId, nodes, base)
      for (const { slab, top: slabTop, underside: slabUnderside } of getWallCoveringSlabs(
        wall,
        level.levelId,
        nodes,
      )) {
        const penetration = Math.max(0, Math.min(wallTop, slabTop) - Math.max(base, slabUnderside))
        const coplanar = Math.abs(wallTop - slabTop) <= 1e-6
        if (penetration <= 1e-6 && !coplanar) continue
        issues.push({
          type: 'wall_covering_slab_contact',
          message: `Wall ${wall.id} top at ${wallTop.toFixed(3)}m intersects covering slab ${slab.id} [${slabUnderside.toFixed(3)}, ${slabTop.toFixed(3)}]m${coplanar ? ' and is coplanar with its walking surface' : ''}; check the wall height or the slab opening.`,
          wallId: wall.id,
          slabId: slab.id,
          levelId: level.levelId,
          wallTop,
          slabUnderside,
          slabTop,
          penetration,
          coplanar,
        })
      }
    }
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
  // Porch or deck steps, a flight to no level, stand on a storey without connecting it to another.
  for (const [buildingId, storeys] of storeysByBuilding) {
    if (storeys.length < 2) continue
    if (holdingUnread.has(buildingId)) continue
    const connected = levels
      .filter((level) => {
        const node = nodes[level.levelId] as AnyNode & { type: 'level' }
        return (levelBuildingId(nodes as Record<AnyNodeId, AnyNode>, node) ?? '') === buildingId
      })
      .some((level) =>
        ofType(onLevel(level.levelId), 'stair').some((stair) =>
          stairReachesStoreyAbove(stair, nodes as Record<string, AnyNode>),
        ),
      )
    if (!connected)
      report(
        'missing_stair',
        `${nodes[buildingId]?.name ?? 'The building'} has ${storeys.length} storeys and no stair between them: add one on the ground floor, in the hall or entry, to connect them.`,
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

  for (const node of Object.values(settled)) {
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

  for (const stair of Object.values(settled).filter(
    (node): node is StairNode => node.type === 'stair',
  )) {
    const sourceLevelId = levelIdOf(nodes, stair.id)
    if (sourceLevelId && holdingUnread.has(buildingOf(sourceLevelId) ?? '')) continue
    const stairName = stair.name ?? stair.id
    for (const diagnostic of measureStair(stair, nodes as Record<string, AnyNode>).diagnostics)
      report(
        `stair_${diagnostic.code.replaceAll('-', '_')}`,
        `Stair ${stairName}: ${diagnostic.message}`,
        diagnostic.code.endsWith('-target'),
      )
    if (sourceLevelId) {
      const sourceName = nodes[sourceLevelId]?.name ?? sourceLevelId
      const footprints = stairFootprintPolygons(nodes, stair)
      const sourceSlabs = ofType(onLevel(sourceLevelId), 'slab')
      // Porch, deck or garden steps start on the ground, off the floor slab.
      if (
        sourceSlabs.length > 0 &&
        !stairClimbsToNoStorey(stair, nodes as Record<string, AnyNode>) &&
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

  // Where each building stands on its lot: past the lot line or into the required yards is a
  // problem, off-centre is not.
  for (const building of queryNodes<BuildingNode>(nodes, { type: 'building' })) {
    const brief = siteBrief(nodes, { buildingId: building.id })
    if (!brief) continue
    const name = building.name ?? 'The building'
    if (brief.buildable.state === 'none')
      report(
        'buildable_area_none',
        `The setbacks leave nothing to build on this lot: check the site's setbacks before standing ${name} on it.`,
      )
    const footprint = brief.footprint
    if (!footprint) continue
    const sides = footprint.overhang.sides.join(', ')
    if (footprint.fit === 'outside')
      report(
        'footprint_outside_site',
        `${name} reaches ${footprint.overhang.lotM.toFixed(1)} m past the lot line (${sides}): place_building centres it in the buildable area; a plan bigger than the lot needs saying so.`,
      )
    else if (footprint.fit === 'lot' && brief.buildable.state !== 'none')
      report(
        'footprint_outside_setbacks',
        `${name} stands ${footprint.overhang.setbacksM.toFixed(1)} m into the required yards (${sides}): place_building centres it in the buildable area.`,
      )
  }

  for (const { nodeId, path, message } of errors)
    issues.push({
      type: 'schema_invalid',
      message: `Schema: ${path ? `${nodeId}.${path}` : nodeId} ${message}`,
      nodeId,
      path,
    })
  for (const [kind, nodeIds] of unknownKinds)
    issues.push({
      type: 'schema_unknown_kind',
      message: `No schema here knows kind ${kind} (${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'}): a plugin's, not checked here.`,
      severity: 'info',
      kind,
      count: nodeIds.length,
      nodeIds: nodeIds.slice(0, UNKNOWN_KIND_IDS),
    })
  // A hidden site, read as stored: a malformed one is still hidden.
  for (const [id, site] of Object.entries(scene))
    if (site?.type === 'site' && site.visible === false)
      issues.push({
        type: 'site_hidden',
        message: `Site ${id} is hidden. ${HIDDEN_SITE_NOTE}`,
        severity: 'info',
        nodeId: id,
      })

  // Door keep-outs and item–item footprint overlaps (rotation-aware).
  issues.push(...layoutIssuesFromScene(Object.values(settled)))
  issues.push(...ceilingObjectObservations(settled))
  issues.push(...wallObjectObservations(settled))
  for (const check of checks)
    if (check.order < CHECKPOINT_ORDER) issues.push(...check.run(settled, input ?? {}))
  // What the edits since the host's checkpoint lost, by place.
  const hosted = context.checkpoint
    ? changesSince(context.checkpoint as SceneCheckpoint, scene)
    : null
  if (hosted) issues.push(...hosted.issues)
  // The look back: what the agent did since a moment it named. The places the registered families
  // lost count as issues, as a window gone from its place always did.
  const session = context.session ?? EMPTY_SESSION
  const since = typeof input?.since === 'string' ? reviewSince(session, input.since, scene) : null
  if (since?.places) issues.push(...since.places.issues)
  for (const check of checks)
    if (check.order >= CHECKPOINT_ORDER) issues.push(...check.run(settled, input ?? {}))

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
      hasIssues: issues.some((issue) => !('severity' in issue && issue.severity === 'info')),
      ...authoredObjects(nodes),
      ...Object.assign({}, ...reports.map((report) => report.run(nodes))),
      ...(Object.keys(session.checkpoints).length
        ? { checkpoints: Object.keys(session.checkpoints) }
        : {}),
      ...(hosted && {
        sinceCheckpoint: { name: context.checkpoint!.name, changes: hosted.changes },
      }),
      ...(since && { since }),
    },
  }
}

/** Objects built by add_object, with what each stands in for: each is a gap in what Pascal builds. */
function authoredObjects(nodes: SceneNodes) {
  // biome-ignore lint/plugin: verify_scene reads the whole scene
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
