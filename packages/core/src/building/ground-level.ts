import { groundSeat } from '../lib/ground-seat'
import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { getLevelElevations } from '../services/storey'

/**
 * Making `levelId` the building's ground floor, as the level panel's "Set as ground floor" and the
 * agent's `set_ground_level` do: the building names it (`groundLevelId`), is seated so that level's
 * floor datum, the top of the foundation, stands over grade as the building's foundation
 * construction seats it (`GroundSeat.aboveGrade`: 0.203 m on block, by region and style); its
 * position moves in height, the plan stays where it is, and the
 * floor indices are renumbered so it is index 0 and the ones under it are the basements. Every
 * floor keeps its place relative to the others. One change set, one undo step. `null` for an id
 * that is no level of a building.
 */
export function buildGroundLevelChanges({
  nodes,
  levelId,
}: {
  nodes: Record<AnyNodeId, AnyNode>
  levelId: string
}) {
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return null
  const buildingId = getLevelElevations(nodes).get(levelId)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  if (building?.type !== 'building') return null

  // Seat against the level asked for, not the one the building names today.
  const asNamed = {
    ...nodes,
    [building.id]: { ...building, groundLevelId: level.id },
  } as Record<AnyNodeId, AnyNode>
  const before = groundSeat(nodes, building.id)
  const seat = groundSeat(asNamed, building.id)
  if (!seat) return null

  const [x, y, z] = (building as BuildingNode).position
  // Micrometres: the seat is measured through sums of storey heights, and a stored height keeps no noise.
  const moveBy = seat.atFoundationTop ? 0 : Math.round((seat.aboveGrade - seat.offset) * 1e6) / 1e6
  const shift = level.level
  const renumbered = Object.values(nodes).filter(
    (node): node is LevelNode =>
      node.type === 'level' &&
      shift !== 0 &&
      getLevelElevations(nodes).get(node.id)?.buildingId === building.id,
  )
  const unchanged =
    before?.explicit === true && before.levelId === level.id && seat.atFoundationTop && shift === 0
  return {
    buildingId: building.id,
    seat,
    moveBy,
    renumbered: renumbered.length > 0,
    unchanged,
    update: [
      {
        id: building.id as AnyNodeId,
        data: {
          groundLevelId: level.id,
          position: [x, Math.round((y + moveBy) * 1e6) / 1e6, z],
        } as Partial<AnyNode>,
      },
      ...renumbered.map((other) => ({
        id: other.id as AnyNodeId,
        data: { level: other.level - shift } as Partial<AnyNode>,
      })),
    ],
  }
}
