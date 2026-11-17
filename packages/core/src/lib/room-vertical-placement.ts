import type { AnyNode, ZoneNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import type { PlateRoom } from './floor-plates'
import { connectedHouseFootprint } from './house-footprint'
import { isLevelAtSiteDatum, levelBaseElevationAt } from './terrain-support-query'

/**
 * Automatic floor datum per room: 0.05 m above the highest ground (terrain +
 * `supportOffset`) under its boundary walls.
 *
 * Manual slabs are deliberately not supports here. Load migration explicitly
 * associates a retained authored floor with its room. Other manual slabs are
 * separate terraces, pads or platforms and must not elect the house datum.
 */
export function autoRoomVerticalPlacements(
  rooms: Pick<PlateRoom, 'zone' | 'spans'>[],
  nodes: Readonly<Record<string, AnyNode>>,
) {
  const floorless = Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.parentId === rooms[0]?.zone.parentId &&
      node.spaceRole === 'room' &&
      node.hasFloor === false &&
      node.floor?.support !== 'open',
  )
  const boundaryIds = new Set(rooms.flatMap((room) => room.spans.map((span) => span.boundaryId)))
  for (const room of floorless) for (const id of room.boundaryWallIds) boundaryIds.add(id)
  const bases = new Map<string, number>()
  for (const id of boundaryIds) {
    const wall = nodes[id]
    if (wall?.type !== 'wall' || wall.parentId !== rooms[0]?.zone.parentId) continue
    bases.set(
      wall.id,
      levelBaseElevationAt(nodes, wall.parentId!, wall.start[0], wall.start[1]) +
        (wall.supportOffset ?? 0),
    )
  }
  const topOf = (ids: string[]) => {
    const heights = ids.flatMap((id) => (bases.has(id) ? [bases.get(id)!] : []))
    return (heights.length ? Math.max(...heights) : 0) + DEFAULT_SLAB_ELEVATION
  }
  const placements = new Map(
    rooms.map((room) => [room.zone.id, topOf(room.spans.map((span) => span.boundaryId))]),
  )
  if (
    !floorless.length ||
    !rooms[0]?.zone.parentId ||
    !isLevelAtSiteDatum(nodes, rooms[0].zone.parentId)
  )
    return placements
  const shared = rooms.filter(
    (room) => !room.zone.floor?.footprint && room.zone.floor?.support !== 'open',
  )
  const footprints = shared.map(({ zone }) => ({ outer: zone.polygon, holes: zone.holes }))
  for (const [index, room] of shared.entries()) {
    const connected = connectedHouseFootprint(footprints[index]!, floorless, footprints)
    const top = Math.max(
      placements.get(room.zone.id)!,
      ...connected.connectedFootprintIndices.map(
        (index) => placements.get(shared[index]!.zone.id)!,
      ),
      ...connected.floorlessRooms.flatMap((zone) =>
        zone.boundaryWallIds.some((id) => bases.has(id)) ? [topOf(zone.boundaryWallIds)] : [],
      ),
    )
    placements.set(room.zone.id, top)
  }
  return placements
}
