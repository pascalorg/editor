import { isOutdoorRoom, roomUseOfName } from '../building/room-use'
import type { AnyNodeId, ZoneNode } from '../schema'
import type { SceneGraph } from '../utils/clone-scene-graph'
import { hidesDescendants } from './node-visibility'
import { area, type Polygon, union } from './polygon-boolean'

export type RoomCounts = {
  rooms: number
  bedrooms: number | null
  modelledAreaM2: number | null
  unclassifiedZones: number
}

/** The viewer lists visible zones with a usable outline, including legacy generic zones. */
export function isRoomZone(zone: Pick<ZoneNode, 'polygon'> & { visible?: boolean }): boolean {
  return zone.visible !== false && zone.polygon.length >= 3
}

/** Counts visible, reachable rooms; area is the indoor footprint union on each level, in m². */
export function roomCounts(graph: SceneGraph): RoomCounts {
  let rooms = 0
  let bedrooms = 0
  let unclassifiedZones = 0
  const byLevel = new Map<AnyNodeId | null, Polygon[]>()
  const visited = new Set<AnyNodeId>()
  const pending = graph.rootNodeIds.map((id) => ({ id, level: null as AnyNodeId | null }))
  while (pending.length) {
    const entry = pending.pop()!
    if (visited.has(entry.id)) continue
    visited.add(entry.id)
    const node = graph.nodes[entry.id]
    if (!node || (node.visible === false && hidesDescendants(node))) continue
    const level = node.type === 'level' ? node.id : entry.level
    if (node.type === 'zone') {
      if (
        !isRoomZone(node) ||
        !node.parentId ||
        graph.nodes[node.parentId as AnyNodeId]?.type !== 'level'
      )
        unclassifiedZones++
      else {
        rooms++
        if (roomUseOfName(node.name) === 'bedroom') bedrooms++
        if (!node.roomType && !isOutdoorRoom(node)) {
          const polygons = byLevel.get(level) ?? []
          polygons.push({ outer: node.polygon, holes: node.holes ?? [] })
          byLevel.set(level, polygons)
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (typeof child === 'string') pending.push({ id: child as AnyNodeId, level })
      }
    }
  }
  return {
    rooms,
    bedrooms: rooms ? bedrooms : null,
    modelledAreaM2: byLevel.size
      ? [...byLevel.values()].reduce((sum, polygons) => sum + area(union(polygons)), 0)
      : null,
    unclassifiedZones,
  }
}
