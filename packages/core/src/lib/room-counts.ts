import { isOutdoorRoom, roomUseOfName } from '../building/room-use'
import type { AnyNodeId, ZoneNode } from '../schema'
import type { SceneGraph } from '../utils/clone-scene-graph'
import { hidesDescendants } from './node-visibility'
import { area, containsPoint, type Polygon, union } from './polygon-boolean'
import { createRoomTopologyIndex } from './space-detection'

export type RoomCounts = {
  rooms: number
  bedrooms: number | null
  modelledAreaM2: number | null
  unclassifiedZones: number
}

/** The viewer lists visible zones with a usable outline, including legacy generic zones. */
export function isRoomZone(
  zone: Pick<ZoneNode, 'polygon'> & { visible?: boolean },
  detected?: Pick<ZoneNode, 'polygon'>,
): boolean {
  return (
    zone.visible !== false && (zone.polygon.length >= 3 || (detected?.polygon.length ?? 0) >= 3)
  )
}

/** Wall topology and zone matching are pure core geometry, also used by the viewer index. */
function detectedOutlines(levelId: string, nodes: SceneGraph['nodes']) {
  const topology = createRoomTopologyIndex()
  topology.rebuildLevel(levelId, nodes)
  const zones = Object.values(nodes)
    .filter(
      (node): node is ZoneNode =>
        node.type === 'zone' &&
        node.parentId === levelId &&
        node.spaceRole === 'room' &&
        node.enclosureStatus !== 'open' &&
        node.floor?.support !== 'open',
    )
    .sort((a, b) => a.id.localeCompare(b.id))
  const matched = new Map<string, Polygon>()
  for (const room of topology.getLevelTopology(levelId)?.rooms ?? []) {
    const boundaryIds = [...new Set(room.spans.map((span) => span.boundaryId))].sort().join('|')
    const available = zones.filter((zone) => !matched.has(zone.id))
    const zone =
      available.find(
        (zone) =>
          [...zone.boundaryWallIds, ...zone.boundarySeparatorIds].sort().join('|') === boundaryIds,
      ) ??
      available.find(
        (zone) =>
          !!zone.seed && containsPoint([{ outer: room.polygon, holes: room.holes }], zone.seed),
      )
    if (zone) matched.set(zone.id, { outer: room.polygon, holes: room.holes })
  }
  return matched
}

/** Counts visible, reachable rooms; area is the indoor footprint union on each level, in m². */
export function roomCounts(graph: SceneGraph): RoomCounts {
  let rooms = 0
  let bedrooms = 0
  let unclassifiedZones = 0
  const byLevel = new Map<AnyNodeId | null, Polygon[]>()
  const outlines = new Map<string, Map<string, Polygon>>()
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
      let outline: Polygon = { outer: node.polygon, holes: node.holes ?? [] }
      if (node.polygon.length < 3 && level) {
        if (!outlines.has(level)) outlines.set(level, detectedOutlines(level, graph.nodes))
        outline = outlines.get(level)!.get(node.id) ?? outline
      }
      if (
        !isRoomZone(node, { polygon: outline.outer }) ||
        !node.parentId ||
        graph.nodes[node.parentId as AnyNodeId]?.type !== 'level'
      )
        unclassifiedZones++
      else {
        rooms++
        if (roomUseOfName(node.name) === 'bedroom') bedrooms++
        if (!node.roomType && !isOutdoorRoom(node)) {
          const polygons = byLevel.get(level) ?? []
          polygons.push(outline)
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
