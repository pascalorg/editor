import { resolveBuildingForLevel, resolveLevelId } from '../lib/node-ancestry'
import type { AnyNode, AnyNodeId, UnitNode } from '../schema'
import { getLevelAbove } from '../services/storey'
import {
  type CirculationGeometryReason,
  circulationGeometryReasons,
  measuredCirculationGraph,
  unmeasuredRouteIds,
} from './circulation-geometry'
import {
  buildCirculationGraph,
  type CirculationGraph,
  type CirculationIssue,
  type CirculationNode,
  circulationLinks,
  exteriorEntranceEdges,
  nodeName,
  reachedFrom,
} from './circulation-graph'
import { queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

export { floorSpaceReader, type Space, wallSidesReader } from './circulation-spaces'

const listed = (names: string[]) =>
  names.length > 8
    ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more`
    : names.join(', ')

function apartmentIssues(
  nodes: SceneNodes,
  graph: CirculationGraph,
  entrance: boolean,
  rawGraph: CirculationGraph,
  cutOff: ReadonlySet<string>,
): CirculationIssue[] {
  const links = circulationLinks(graph)
  const groundIds = new Set<string>(
    graph.floors.filter((floor) => floor.ground).map((floor) => floor.id),
  )
  const starts = entrance
    ? ['outside']
    : [...graph.nodes.values()]
        .filter((node) => node.levelId && groundIds.has(node.levelId) && !node.apartment)
        .map((node) => node.id)
  const everywhere = reachedFrom(links, starts)
  const shared = reachedFrom(links, starts, (id) => !graph.nodes.get(id)?.apartment)
  const rawLinks = circulationLinks(rawGraph)
  const unmeasured = unmeasuredRouteIds(reachedFrom(rawLinks, starts), everywhere)
  const unmeasuredShared = unmeasuredRouteIds(
    reachedFrom(rawLinks, starts, (id) => !rawGraph.nodes.get(id)?.apartment),
    shared,
  )
  const unreachable: string[] = [],
    through: string[] = []
  for (const unit of queryNodes<UnitNode>(nodes, { type: 'unit' })) {
    if ((unit.kind ?? 'apartment') !== 'apartment') continue
    const keys = [...graph.nodes.values()]
      .filter((node) => node.apartment === unit.id)
      .map((node) => node.id)
    if (!keys.length) continue
    if (!keys.some((id) => everywhere.has(id))) {
      const onCutOffLevels = keys.every((id) => cutOff.has(graph.nodes.get(id)?.levelId ?? ''))
      if (!(onCutOffLevels || keys.some((id) => unmeasured.has(id)))) unreachable.push(unit.id)
    } else if (!keys.some((id) => shared.has(id) || unmeasuredShared.has(id))) through.push(unit.id)
  }
  const issues: CirculationIssue[] = []
  if (unreachable.length)
    issues.push({
      type: 'apartment_unreachable',
      message: `${unreachable.length} apartment${unreachable.length === 1 ? '' : 's'} cannot be reached from ${entrance ? 'the entrance' : "the ground floor's corridors"}: ${listed(unreachable.map((id) => nodeName(nodes, id)))}.`,
      nodeIds: unreachable,
    })
  if (through.length)
    issues.push({
      type: 'reached_through_apartment',
      message: `${through.length} apartment${through.length === 1 ? ' is' : 's are'} reached only by crossing another apartment: ${listed(through.map((id) => nodeName(nodes, id)))}.`,
      nodeIds: through,
    })
  return issues
}

/** Why a level is or is not reached from an entrance; null when it is. */
export type CirculationLevelReason = 'no_connection' | 'no_landing' | 'no_entrance' | 'not_measured'

/** Whether a level can be reached from an entrance: true, false, or null where it cannot be measured. */
export type CirculationLevel = {
  levelId: string
  name: string
  buildingId: string | null
  reachable: boolean | null
  reason: CirculationLevelReason | null
  spaces: number
  reachedSpaces: number
}

export type CirculationReach = {
  /** The graph the reading measures: raw, or without the geometry that cannot be measured. */
  graph: CirculationGraph
  geometry: CirculationGeometryReason[]
  /** A multiple-building, tilted or floorless scene has no frame to measure a route in. */
  frameLimited: boolean
  entrance: boolean
  reached: Set<string>
  /** Graph nodes whose route is not measurable: neither reached nor proven cut off. */
  unmeasured: Set<string>
  /** Per level that holds a space to reach. */
  levels: CirculationLevel[]
  /** Level ids where a flight or lift serves the level but arrives at no floor. */
  landingTrouble: Set<string>
  /** Spaces behind a door whose approach from outside cannot be measured. */
  behindUnmeasuredEntrance: Set<string>
}

const FRAME_REASONS = ['multiple_buildings', 'tilted_buildings', 'floor_missing']

function stairLevelIds(nodes: SceneNodes, id: string): string[] {
  const stair = nodes[id]
  if (stair?.type !== 'stair') return []
  const foot = stair.fromLevelId ?? resolveLevelId(stair, nodes)
  const head = stair.toLevelId ?? (foot ? getLevelAbove(foot, nodes)?.id : undefined)
  return [foot, head].filter((levelId): levelId is string => typeof levelId === 'string')
}

/**
 * The one reading of reach that verify_scene and the circulation findings share: what is reached from
 * any entrance, what is unmeasured, and, per level, whether an entrance reaches it at all.
 */
export function circulationReach(
  nodes: SceneNodes,
  rawGraph: CirculationGraph,
  geometry: CirculationGeometryReason[] = circulationGeometryReasons(nodes, rawGraph),
): CirculationReach {
  const frameLimited = geometry.some((reason) => FRAME_REASONS.includes(reason.code))
  const graph = frameLimited ? rawGraph : measuredCirculationGraph(nodes, rawGraph, geometry)
  const entrance = exteriorEntranceEdges(graph).length > 0
  const reached = reachedFrom(circulationLinks(graph), entrance ? ['outside'] : [])
  const rawLinks = circulationLinks(rawGraph)
  const noRoute = !entrance && geometry.length > 0
  const behindUnmeasuredEntrance = reachedFrom(
    rawLinks,
    rawGraph.unmeasuredEntrances
      .map((unmeasured) => unmeasured.spaceId)
      .filter((id) => rawGraph.nodes.has(id)),
    (id) => id !== 'outside',
  )
  const unmeasured = new Set<string>([
    ...unmeasuredRouteIds(reachedFrom(rawLinks, ['outside']), reached),
    ...[...behindUnmeasuredEntrance].filter((id) => !reached.has(id)),
    ...(noRoute ? [...rawGraph.nodes.keys()].filter((id) => !reached.has(id)) : []),
  ])
  const landingTrouble = new Set<string>()
  for (const issue of rawGraph.issues) {
    if (issue.type !== 'stair_has_no_landing' && issue.type !== 'lift_door_blocked') continue
    for (const id of issue.levelIds ?? []) landingTrouble.add(id)
    for (const nodeId of issue.nodeIds)
      for (const id of stairLevelIds(nodes, nodeId)) landingTrouble.add(id)
  }
  const levels = rawGraph.floors.flatMap((floor): CirculationLevel[] => {
    const spaces = [...rawGraph.nodes.values()].filter(
      (node) =>
        node.levelId === floor.id &&
        (node.kind === 'room' || node.kind === 'zone' || node.kind === 'floor') &&
        !rawGraph.nonSpaces.has(node.id),
    )
    if (!spaces.length) return []
    const reachedSpaces = spaces.filter((node) => reached.has(node.id)).length
    const lost = (node: CirculationNode) => unmeasured.has(node.id) || !graph.nodes.has(node.id)
    const [reachable, reason]: [boolean | null, CirculationLevelReason | null] = frameLimited
      ? [null, 'not_measured']
      : !entrance
        ? [null, 'no_entrance']
        : reachedSpaces
          ? [true, null]
          : spaces.some(lost)
            ? [null, 'not_measured']
            : [false, landingTrouble.has(floor.id) ? 'no_landing' : 'no_connection']
    return [
      {
        levelId: floor.id,
        name: floor.name,
        buildingId: resolveBuildingForLevel(floor.id, nodes as Record<AnyNodeId, AnyNode>) ?? null,
        reachable,
        reason,
        spaces: spaces.length,
        reachedSpaces,
      },
    ]
  })
  return {
    graph,
    geometry,
    frameLimited,
    entrance,
    reached,
    unmeasured,
    levels,
    landingTrouble,
    behindUnmeasuredEntrance,
  }
}

const levelFact = (name: string, building: string) =>
  `${name} of ${building} has no walkable stair or lift to it from an entrance`

export function circulationGraphIssues(
  nodes: SceneNodes,
  rawGraph: CirculationGraph,
  reach: CirculationReach = circulationReach(nodes, rawGraph),
): CirculationIssue[] {
  const issues = [...rawGraph.issues]
  const { geometry } = reach
  issues.push(
    ...geometry.map(
      (reason): CirculationIssue => ({
        type: 'circulation_not_measured',
        message: reason.message,
        nodeIds: reason.nodeIds,
        reasonCode: reason.code,
      }),
    ),
  )
  if (reach.frameLimited) return issues
  const { graph, entrance, reached, unmeasured } = reach
  if (!entrance && geometry.length) return issues
  const ground = graph.floors.find((floor) => floor.ground)
  const spaces = [...graph.nodes.values()].filter(
    (node) =>
      (node.kind === 'room' || node.kind === 'zone' || node.kind === 'floor') &&
      !graph.nonSpaces.has(node.id),
  )
  if (!entrance && ground && spaces.length)
    issues.push({
      type: 'no_exterior_door',
      message: `No door, open edge or entrance steps connect outside to an interior space on ${ground.name}: the building cannot be entered.`,
      nodeIds: [ground.id],
      levelIds: [ground.id],
    })
  // A level no entrance reaches is one fact about the level; its rooms are not raised one by one.
  const cutOff = new Set(
    reach.levels.filter((level) => level.reachable === false).map((level) => level.levelId),
  )
  for (const level of reach.levels) {
    if (level.reachable !== false) continue
    const building = (level.buildingId && nodes[level.buildingId]?.name) || 'the building'
    issues.push({
      type: 'missing_stair',
      message: `${levelFact(level.name, building)}.`,
      nodeIds: [level.levelId],
      levelIds: [level.levelId],
      ...(level.reason ? { reasonCode: level.reason } : {}),
    })
  }
  const rooms = spaces.filter(
    (node) =>
      !reached.has(node.id) &&
      (!node.apartment || unmeasured.has(node.id)) &&
      !(cutOff.has(node.levelId ?? '') && !unmeasured.has(node.id)),
  )
  for (const room of rooms) {
    const limited = unmeasured.has(room.id)
    const entryUnmeasured = limited && reach.behindUnmeasuredEntrance.has(room.id)
    issues.push({
      type: limited ? 'circulation_not_measured' : 'room_unreachable',
      message: entryUnmeasured
        ? `${room.name} access is not measured because the door that enters it opens high above the modeled ground.`
        : limited
          ? `${room.name} access is not measured because its route crosses unmeasured walking geometry.`
          : `${room.name} cannot be reached from outside through modeled doors, openings, open edges, stairs or lifts.`,
      ...(limited
        ? { reasonCode: entryUnmeasured ? 'entrance_not_measured' : 'route_not_measured' }
        : {}),
      nodeIds: [room.sourceId ?? room.levelId ?? room.id],
      levelIds: room.levelId ? [room.levelId] : [],
      spaceId: room.id,
    })
  }
  issues.push(...apartmentIssues(nodes, graph, entrance, rawGraph, cutOff))
  return issues
}

export function circulationDiagnostics(nodes: SceneNodes): CirculationIssue[] {
  return circulationGraphIssues(nodes, buildCirculationGraph(nodes))
}
