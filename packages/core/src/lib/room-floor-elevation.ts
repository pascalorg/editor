import type { AnyNode, SlabNode, ZoneNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { floorPlateHoldsUnderside } from './floor-foundation-datum'
import { area } from './polygon-boolean'

type Nodes = Readonly<Record<string, AnyNode>>
const isRoom = (node: AnyNode | undefined): node is ZoneNode =>
  node?.type === 'zone' && node.spaceRole === 'room'
const isGroundRoom = (node: AnyNode | undefined): node is ZoneNode =>
  isRoom(node) && node.floor?.support !== 'open'
/** The level's footprints, largest first (ties by id, so the order is stable). */
export function levelFootprints(nodes: Record<string, AnyNode>, levelId: string): SlabNode[] {
  return Object.values(nodes)
    .filter(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && node.parentId === levelId,
    )
    .sort(
      (a, b) =>
        area([{ outer: b.polygon, holes: b.holes }]) -
          area([{ outer: a.polygon, holes: a.holes }]) || a.id.localeCompare(b.id),
    )
}

/** A room's separate base plate, only when no other ground room shares it. */
export function roomOwnPlate(nodes: Nodes, zoneId: string): SlabNode | null {
  const zone = nodes[zoneId]
  if (!isRoom(zone) || !zone.floor?.footprint || zone.floor.support === 'open') return null
  const plate = zone.parentId
    ? levelFootprints(nodes as Record<string, AnyNode>, zone.parentId).find((plate) =>
        plate.zoneIds?.includes(zoneId),
      )
    : null
  if (!plate) return null
  const alone = !(plate.zoneIds ?? []).some((id) => id !== zoneId && isGroundRoom(nodes[id]))
  return alone ? plate : null
}

export function roomFloorElevationOffset(nodes: Nodes, zoneId: string): number {
  const zone = nodes[zoneId]
  if (!isGroundRoom(zone) || zone.floor?.footprint) return 0
  const base = Object.values(nodes).find(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.plateRole === 'base' &&
      node.parentId === zone.parentId &&
      !!node.zoneIds?.includes(zone.id),
  )
  if (
    !base ||
    base.floorHeight !== undefined ||
    base.referenceFloorElevation !== undefined ||
    floorPlateHoldsUnderside(nodes, base)
  )
    return 0
  return base.elevation - DEFAULT_SLAB_ELEVATION
}

/** Stored room steps ride the automatic ground datum; authored plate tops stay absolute. */
export function roomFloorElevation(nodes: Nodes, zoneId: string): number {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') return 0
  if (typeof zone.floor?.elevation === 'number')
    return zone.floor.elevation + roomFloorElevationOffset(nodes, zoneId)
  const own = roomOwnPlate(nodes, zoneId)
  if (own) return own.elevation
  const plates = Object.values(nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && !!node.zoneIds?.includes(zoneId),
  )
  const base = plates.find((plate) => plate.plateRole === 'base')
  const baseTop = base?.elevation
  if (baseTop !== undefined && zone.floor?.drop !== undefined) return baseTop - zone.floor.drop
  const plate = plates[0]
  return (plate === base ? baseTop : plate?.elevation) ?? DEFAULT_SLAB_ELEVATION
}

/** The walking surface of a room the separator closes, else zero. */
export function separatorFloorElevation(nodes: Nodes, separatorId: string): number {
  const zone = Object.values(nodes).find(
    (node) => node.type === 'zone' && node.boundarySeparatorIds.includes(separatorId),
  )
  return zone ? roomFloorElevation(nodes, zone.id) : 0
}
