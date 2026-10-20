import { containsPoint } from '../../lib/polygon-boolean'
import { queryNodes } from '../../runtime/node-queries'
import type { AnyNode, AnyNodeId, LevelNode, StairNode, StairSegmentNode } from '../../schema'
import { StairDesignTargets } from '../../schema/nodes/stair-design-targets'
import { DEFAULT_LEVEL_HEIGHT } from '../../services/level-height'
import {
  findLevelAboveId,
  getLevelElevations,
  getLevelFloorToFloorHeight,
} from '../../services/storey'
import { stairBaseElevation } from './stair-base-elevation'
import { stairArrivalOpening } from './stair-footprint'

/** The level a stair rises from: the one it names, else the one holding it. */
function stairSourceLevel(stair: StairNode, nodes: Record<string, AnyNode>): LevelNode | undefined {
  const requested = stair.fromLevelId ? nodes[stair.fromLevelId] : undefined
  if (requested?.type === 'level') return requested
  const parent = stair.parentId ? nodes[stair.parentId] : undefined
  if (parent?.type === 'level') return parent
  return Object.values(nodes).find(
    (node): node is LevelNode => node.type === 'level' && (node.children ?? []).includes(stair.id),
  )
}

export function resolveStairTotalRise(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  baseElevationFor = stairBaseElevation,
  legacyArrival = false,
): number {
  if (stair.totalRise !== undefined) return stair.totalRise

  const level = stairSourceLevel(stair, nodes)

  // Both destinations are absolute level-local heights, while the stair's own
  // base may be lifted onto a floor slab by the floor-stack
  // (`FloorElevationSystem` / `syncStairGroupElevation` put the group at
  // `position[1] + elected slab elevation`). The rise is measured from that
  // base, so subtract it — electing the base exactly the way the visual
  // systems do (persisted `supportSlabId` honored, uncapped election
  // otherwise) keeps base + rise landing precisely on the destination surface.
  const baseElevation = baseElevationFor(stair, nodes, level?.id ?? null)

  if (stair.deckSlabId) {
    // The deck's `elevation` IS its walking surface (level-local). A stale
    // reference (deck gone) falls through to the level-derived rise.
    const deck = nodes[stair.deckSlabId]
    if (deck?.type === 'slab') return (deck.elevation ?? 0.05) - baseElevation
  }

  if (!level) return DEFAULT_LEVEL_HEIGHT
  if (legacyArrival)
    return getLevelFloorToFloorHeight(level.id, nodes as Record<AnyNodeId, AnyNode>) - baseElevation
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const requestedDestination = stair.toLevelId ? elevations.get(stair.toLevelId) : undefined
  const sourceElevation = elevations.get(level.id)
  const destinationId =
    requestedDestination &&
    sourceElevation &&
    requestedDestination.buildingId === sourceElevation.buildingId &&
    requestedDestination.ordinal > sourceElevation.ordinal
      ? stair.toLevelId!
      : findLevelAboveId(level.id, elevations)
  if (!destinationId)
    return getLevelFloorToFloorHeight(level.id, nodes as Record<AnyNodeId, AnyNode>) - baseElevation
  const opening = stairArrivalOpening(stair, nodes)
  const point: [number, number] = opening.length
    ? [
        opening.reduce((sum, vertex) => sum + vertex[0], 0) / opening.length,
        opening.reduce((sum, vertex) => sum + vertex[1], 0) / opening.length,
      ]
    : [stair.position[0], stair.position[2]]
  const covers = (polygon: [number, number][], holes: [number, number][][]) =>
    containsPoint([{ outer: polygon, holes }], point)
  const room = Object.values(nodes).find(
    (node) =>
      node.type === 'zone' &&
      node.parentId === destinationId &&
      node.spaceRole === 'room' &&
      node.enclosureStatus !== 'open' &&
      node.hasFloor !== false &&
      node.floor?.support !== 'open' &&
      node.floor?.elevation !== undefined &&
      covers(node.polygon, node.holes ?? []),
  )
  const plate = Object.values(nodes).find(
    (node) =>
      node.type === 'slab' &&
      node.parentId === destinationId &&
      node.plateRole === 'base' &&
      covers(node.polygon, []),
  )
  const top =
    room?.type === 'zone' ? room.floor!.elevation! : plate?.type === 'slab' ? plate.elevation : 0
  return (
    elevations.get(destinationId)!.baseY - elevations.get(level.id)!.baseY + top - baseElevation
  )
}

const RISE_SYNC_EPSILON = 1e-4

/**
 * Keeps straight stairs' flight segments in step with the resolved rise.
 * Straight-stair geometry derives from per-segment heights (not from
 * `resolveStairTotalRise`), so level-height and deck-elevation changes must
 * write through to the flight segments — curved/spiral stairs read the
 * resolved rise directly and need no sync.
 *
 * Scope: stairs whose total the system owns — follows-mode stairs (absent
 * `totalRise`, tracking their level or their deck) and deck-attached stairs
 * (an explicit rise converges to the typed value). A detached stair with an
 * explicit `totalRise` keeps its hand-edited segment chain, unless the user
 * enabled uniform risers. Flight heights otherwise scale proportionally
 * (landings keep theirs); returns `updateNodes` patches, empty when every
 * stair is already in step.
 */
export function syncStairRises(
  nodes: Record<string, AnyNode>,
  baseElevationFor = stairBaseElevation,
  legacyArrival = false,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []

  for (const node of queryNodes<StairNode>(nodes, { type: 'stair' })) {
    if ((node.stairType ?? 'straight') !== 'straight') continue
    const deck = node.deckSlabId ? nodes[node.deckSlabId] : undefined
    if (node.totalRise !== undefined && deck?.type !== 'slab' && !node.uniformRisers) continue

    const segments = (node.children ?? [])
      .map((childId) => nodes[childId])
      .filter((child): child is StairSegmentNode => child?.type === 'stair-segment')
    const flights = segments.filter((segment) => segment.segmentType === 'stair')
    if (flights.length === 0) continue

    const landingRise = segments
      .filter((segment) => segment.segmentType !== 'stair')
      .reduce((sum, segment) => sum + segment.height, 0)
    const flightRise = flights.reduce((sum, segment) => sum + segment.height, 0)
    const targetFlightRise =
      resolveStairTotalRise(node, nodes, baseElevationFor, legacyArrival) - landingRise
    if (!Number.isFinite(targetFlightRise) || targetFlightRise <= 0) continue
    if (!node.uniformRisers && Math.abs(flightRise - targetFlightRise) <= RISE_SYNC_EPSILON)
      continue
    const count = flights.reduce((sum, flight) => sum + Math.max(0, flight.stepCount), 0)

    for (const flight of flights) {
      // A sole flight owns the exact target; proportional scaling adds undo/redo rounding drift.
      const height =
        flights.length === 1
          ? targetFlightRise
          : node.uniformRisers && count > 0
            ? (targetFlightRise * Math.max(0, flight.stepCount)) / count
            : flightRise > RISE_SYNC_EPSILON
              ? flight.height * (targetFlightRise / flightRise)
              : targetFlightRise / flights.length
      if (Math.abs(height - flight.height) > RISE_SYNC_EPSILON)
        updates.push({ id: flight.id as AnyNodeId, data: { height } })
    }
  }

  return updates
}

export function stairHasNoRise(stair: StairNode, nodes: Record<string, AnyNode>): boolean {
  return resolveStairTotalRise(stair, nodes) <= 0
}

/**
 * Steps that stand on a storey without climbing to another: a flight onto a deck, or a flight to
 * no level, one naming the level it rises from and none it arrives on (create_stair's
 * `toLevelId: null`: porch, deck or garden steps), whatever its rise.
 */
export function stairClimbsToNoStorey(stair: StairNode, nodes: Record<string, AnyNode>): boolean {
  if (stair.deckSlabId && nodes[stair.deckSlabId]?.type === 'slab') return true
  return !!stair.fromLevelId && !stair.toLevelId
}

/**
 * Whether a stair climbs to the storey above the one it rises from: what verify_scene and the
 * hosts' checks count as a way upstairs. Steps that climb to no storey do not; a stair naming a
 * level above does. Otherwise, with a storey above, a stair that follows its storey (no
 * `totalRise`) reaches it, and one keeping a rise of its own (an Architect add_stair flight, an
 * editor stair given a custom rise) does when that rise is within a riser of the floor-to-floor
 * height. A declared roof level is no storey (`isRoofLevel`, read here without the registry
 * roof-level.ts loads, which the hosts' checks must not).
 */
export function stairReachesStoreyAbove(stair: StairNode, nodes: Record<string, AnyNode>): boolean {
  if (stairClimbsToNoStorey(stair, nodes)) return false
  const level = stairSourceLevel(stair, nodes)
  if (!level) return false
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const storey = (id: string | null | undefined) => {
    const node = id ? nodes[id] : undefined
    return node?.type === 'level' && node.metadata?.role !== 'roof'
      ? elevations.get(node.id)
      : undefined
  }
  const source = elevations.get(level.id)
  const named = storey(stair.toLevelId)
  if (source && named && named.buildingId === source.buildingId && named.ordinal > source.ordinal)
    return true
  const above = storey(findLevelAboveId(level.id, elevations))
  if (!(source && above)) return false
  if (stair.totalRise === undefined) return true
  const riser = StairDesignTargets.parse(stair.designTargets ?? {}).maxRiserHeight
  return Math.abs(stair.totalRise - (above.baseY - source.baseY)) < riser
}
