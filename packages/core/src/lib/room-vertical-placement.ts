import type { AnyNode, WallNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import type { PlateRoom } from './floor-plates'
import { levelBaseElevationAt } from './terrain-support-query'

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
  const boundaryIds = new Set(rooms.flatMap((room) => room.spans.map((span) => span.boundaryId)))
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
  return new Map(
    rooms.map((room) => {
      const heights = room.spans.flatMap((span) => {
        const base = bases.get(span.boundaryId as WallNode['id'])
        return base === undefined ? [] : [base]
      })
      return [room.zone.id, (heights.length ? Math.max(...heights) : 0) + DEFAULT_SLAB_ELEVATION]
    }),
  )
}
