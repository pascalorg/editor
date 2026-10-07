import type { AnyNode, SlabNode, ZoneNode } from '../schema'
import {
  area,
  difference,
  intersection,
  type MultiPolygon,
  type Polygon,
  union,
} from './polygon-boolean'

/**
 * A room whose floor is a hand-drawn slab (legacy or authored), not a generated
 * plate. Plate derivation skips such a room (see `buildFloorPlates`), so a
 * room floor height would move nothing: the slab itself is what to edit.
 */
export type RoomDrawnFloor = {
  /** The slab the room's floor was taken from (`floor.sourceSlabId`). */
  sourceId: string
  /** The drawn slab the room visibly stands on: the one showing over most of its floor. */
  slabId: string
  /** Other rooms that slab also floors. */
  sharedZoneIds: string[]
  /** More than one drawn slab shows in the room; `slabId` is the largest. */
  ambiguous: boolean
}

type Nodes = Readonly<Record<string, AnyNode>>

const isDrawnSlab = (node: AnyNode | undefined): node is SlabNode =>
  node?.type === 'slab' && !node.plateRole && node.boundary !== 'auto' && !node.autoFromWalls

const footprint = (node: { polygon: SlabNode['polygon']; holes?: SlabNode['holes'] }): Polygon => ({
  outer: node.polygon,
  holes: node.holes ?? [],
})

const memo = new WeakMap<object, Map<string, RoomDrawnFloor | null>>()

export function roomDrawnFloor(nodes: Nodes, zoneId: string): RoomDrawnFloor | null {
  let cache = memo.get(nodes)
  if (!cache) {
    cache = new Map()
    memo.set(nodes, cache)
  }
  if (!cache.has(zoneId)) cache.set(zoneId, computeRoomDrawnFloor(nodes, zoneId))
  return cache.get(zoneId)!
}

function computeRoomDrawnFloor(nodes: Nodes, zoneId: string): RoomDrawnFloor | null {
  const zone = nodes[zoneId]
  // A switched-off floor (`hasFloor: false`) still names its slab: the drawn
  // slab stays visible, so the room stands on it all the same.
  if (
    zone?.type !== 'zone' ||
    !zone.parentId ||
    zone.floor?.support === 'open' ||
    !zone.floor?.sourceSlabId
  )
    return null
  const source = nodes[zone.floor.sourceSlabId]
  if (!isDrawnSlab(source) || source.parentId !== zone.parentId) return null
  const room = footprint(zone)
  // The same overlap that keeps the room out of plate derivation.
  if (area(intersection(room, footprint(source))) <= 1e-4) return null
  const roomArea = area([room])
  const slabs = Object.values(nodes)
    .filter(
      (node): node is SlabNode =>
        isDrawnSlab(node) &&
        node.parentId === zone.parentId &&
        node.visible !== false &&
        node.support !== 'open' &&
        !node.recessed,
    )
    .sort((a, b) => b.elevation - a.elevation || a.id.localeCompare(b.id))
  // Top down: each slab shows where no higher slab already covers the room.
  let covered: MultiPolygon = []
  const shown: Array<{ slab: SlabNode; visible: number }> = []
  for (const slab of slabs) {
    const inRoom = intersection(footprint(slab), room)
    if (area(inRoom) <= 1e-4) continue
    const visible = covered.length ? area(difference(inRoom, covered)) : area(inRoom)
    covered = union([...covered, ...inRoom])
    if (visible > 1e-4) shown.push({ slab, visible })
  }
  shown.sort((a, b) => b.visible - a.visible || b.slab.elevation - a.slab.elevation)
  const slab = shown[0]?.slab ?? source
  const minor = Math.max(0.05, roomArea * 0.02)
  const sharedZoneIds = Object.values(nodes)
    .filter(
      (node): node is ZoneNode =>
        node.type === 'zone' &&
        node.id !== zone.id &&
        node.parentId === zone.parentId &&
        node.spaceRole === 'room' &&
        node.floor?.support !== 'open' &&
        area(intersection(footprint(node), footprint(slab))) > 0.05,
    )
    .map((node) => node.id)
    .sort()
  return {
    sourceId: source.id,
    slabId: slab.id,
    sharedZoneIds,
    ambiguous: shown.filter((entry) => entry.visible > minor).length > 1,
  }
}

/**
 * The refusal for a floor height on a drawn-slab room: the height lives on the
 * slab, so the room names it instead of storing a height nothing reads.
 */
export function drawnFloorElevationConflict(nodes: Nodes, zoneId: string) {
  const floor = roomDrawnFloor(nodes, zoneId)
  if (!floor) return null
  const slab = nodes[floor.slabId] as SlabNode
  const name = slab.name?.trim() || 'a drawn slab'
  return {
    code: 'room-drawn-floor' as const,
    nodeIds: [zoneId, floor.slabId],
    message: `This room's floor is ${name === 'a drawn slab' ? name : `the drawn slab "${name}"`} (${floor.slabId}). Its height is the slab's: change that slab's elevation instead.`,
  }
}
