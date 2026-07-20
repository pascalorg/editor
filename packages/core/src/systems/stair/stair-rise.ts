import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../../services/level-height'
import { getStoredLevelHeight } from '../../services/storey'

export function resolveStairTotalRise(stair: StairNode, nodes: Record<string, AnyNode>): number {
  if (stair.totalRise !== undefined) return stair.totalRise

  if (stair.deckSlabId) {
    const deck = nodes[stair.deckSlabId]
    // The mezzanine stair stands on the storey floor (Y 0) and the deck's
    // `elevation` IS its walking surface, so rise = elevation — the same
    // value the deck tools used to write as an explicit totalRise. A stale
    // reference (deck gone) falls through to the level-derived rise.
    if (deck?.type === 'slab') return deck.elevation ?? 0.05
  }

  const level = Object.values(nodes).find(
    (node) => node.type === 'level' && node.children.includes(stair.id),
  )
  return level?.type === 'level' ? getStoredLevelHeight(level) : DEFAULT_LEVEL_HEIGHT
}

const RISE_SYNC_EPSILON = 1e-4

/**
 * Keeps deck-attached straight stairs' flight segments in step with the
 * resolved rise. Straight-stair geometry derives from per-segment heights
 * (not from `resolveStairTotalRise`), so a deck elevation change must write
 * through to the flight segments — curved/spiral stairs read the resolved
 * rise directly and need no sync. Flight heights scale proportionally
 * (landings keep theirs); returns `updateNodes` patches, empty when every
 * stair is already in step.
 */
export function syncDeckAttachedStairRises(
  nodes: Record<string, AnyNode>,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []

  for (const node of Object.values(nodes)) {
    if (node.type !== 'stair' || node.stairType !== 'straight' || !node.deckSlabId) continue
    const deck = nodes[node.deckSlabId]
    if (deck?.type !== 'slab') continue

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
