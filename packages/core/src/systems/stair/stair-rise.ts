import { getFloorStackedPosition } from '../../hooks/spatial-grid/floor-placed-elevation'
import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../../services/level-height'
import { getStoredLevelHeight } from '../../services/storey'

export function resolveStairTotalRise(stair: StairNode, nodes: Record<string, AnyNode>): number {
  if (stair.totalRise !== undefined) return stair.totalRise

  const level = Object.values(nodes).find(
    (node) => node.type === 'level' && node.children.includes(stair.id),
  )

  if (stair.deckSlabId) {
    const deck = nodes[stair.deckSlabId]
    // The deck's `elevation` IS its walking surface (level-local), but the
    // stair's own base may be lifted onto a floor slab by the floor-stack
    // (`FloorElevationSystem` / `syncStairGroupElevation` put the group at
    // `position[1] + elected slab elevation`). The rise is measured from
    // that base, so subtract it — electing the base exactly the way the
    // visual systems do (persisted `supportSlabId` honored, uncapped
    // election otherwise) keeps base + rise landing precisely on the deck's
    // walking surface. A stale reference (deck gone) falls through to the
    // level-derived rise.
    if (deck?.type === 'slab') {
      const baseElevation = getFloorStackedPosition({
        node: stair,
        nodes,
        position: stair.position,
        rotation: stair.rotation,
        levelId: level?.id ?? null,
      })[1]
      return (deck.elevation ?? 0.05) - baseElevation
    }
  }

  return level?.type === 'level' ? getStoredLevelHeight(level) : DEFAULT_LEVEL_HEIGHT
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
 * explicit `totalRise` is the one place hand-edited segment chains are
 * legitimate, so it is never touched. Flight heights scale proportionally
 * (landings keep theirs); returns `updateNodes` patches, empty when every
 * stair is already in step.
 */
export function syncStairRises(
  nodes: Record<string, AnyNode>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []

  for (const node of Object.values(nodes)) {
    if (node.type !== 'stair' || node.stairType !== 'straight') continue
    const deck = node.deckSlabId ? nodes[node.deckSlabId] : undefined
    if (node.totalRise !== undefined && deck?.type !== 'slab') continue

    const segments = (node.children ?? [])
      .map((childId) => nodes[childId])
      .filter((child): child is StairSegmentNode => child?.type === 'stair-segment')
    const flights = segments.filter((segment) => segment.segmentType === 'stair')
    if (flights.length === 0) continue

    const landingRise = segments
      .filter((segment) => segment.segmentType !== 'stair')
      .reduce((sum, segment) => sum + segment.height, 0)
    const flightRise = flights.reduce((sum, segment) => sum + segment.height, 0)
    const targetFlightRise = resolveStairTotalRise(node, nodes) - landingRise
    if (targetFlightRise <= 0) continue
    if (Math.abs(flightRise - targetFlightRise) <= RISE_SYNC_EPSILON) continue

    for (const flight of flights) {
      const height =
        flightRise > RISE_SYNC_EPSILON
          ? flight.height * (targetFlightRise / flightRise)
          : targetFlightRise / flights.length
      updates.push({ id: flight.id as AnyNodeId, data: { height } })
    }
  }

  return updates
}
