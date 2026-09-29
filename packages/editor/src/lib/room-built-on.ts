import {
  type AnyNode,
  roomFloorChoices as coreRoomFloorChoices,
  roomDrawnFloor,
  type SlabNode,
  type ZoneNode,
} from '@pascal-app/core'
import { levelFootprints } from './floor-footprints'

// "Built on": which floor a room stands on. By default a room is part of its
// connected footprint's shared floor (`floor.footprint` absent); a floor key
// puts it on a separate floor — a lanai a step below the house, with its own
// height, thickness and foundation — shared by every touching room with the
// same key. These helpers read that choice in the words the room panel uses.

type Nodes = Readonly<Record<string, AnyNode>>

/**
 * One floor a room can stand on: its key (null = the shared floor), plate and
 * name. A null plate is the shared floor of a room no shared floor touches:
 * picking it gives the room a shared floor of its own.
 */
export type FloorChoice = { key: string | null; plateId: string | null; name: string }
/** A floor that exists: its plate is in the scene. */
export type PlateChoice = FloorChoice & { plateId: string }

const SHARED_FLOOR: FloorChoice = { key: null, plateId: null, name: 'Shared floor' }

const isRoom = (node: AnyNode | undefined): node is ZoneNode =>
  node?.type === 'zone' && node.spaceRole === 'room'

const isGroundRoom = (node: AnyNode | undefined): node is ZoneNode =>
  isRoom(node) && node.floor?.support !== 'open'

/** The room's floor key: null on the shared floor. */
export function roomFloorKey(nodes: Nodes, zoneId: string): string | null {
  const zone = nodes[zoneId]
  return (isRoom(zone) && zone.floor?.footprint) || null
}

/** The base plate listing the room, if any. */
function listingPlate(nodes: Nodes, zone: ZoneNode): SlabNode | null {
  if (!zone.parentId) return null
  return (
    levelFootprints(nodes as Record<string, AnyNode>, zone.parentId).find((plate) =>
      plate.zoneIds?.includes(zone.id),
    ) ?? null
  )
}

/**
 * The floors a room can stand on (core's `roomFloorChoices`): the one it is
 * on first, then every floor of its level it touches, each by
 * `floorFootprintName`. Drawn slabs and mezzanine decks are no floor to move
 * a room onto.
 */
export function roomFloorChoices(nodes: Nodes, zoneId: string): PlateChoice[] {
  return coreRoomFloorChoices(nodes, zoneId)
    .filter((choice) => !choice.drawn && !choice.mezzanine)
    .map(({ key, plateId, name }) => ({ key, plateId, name }))
}

/**
 * The plate a room on a separate floor stands on alone: its height is that
 * plate's floor height (nothing else stands on it). Null for a room on the
 * shared floor or sharing its separate floor with other rooms.
 */
export function roomOwnPlate(nodes: Nodes, zoneId: string): SlabNode | null {
  const zone = nodes[zoneId]
  if (!isRoom(zone) || !zone.floor?.footprint || zone.floor.support === 'open') return null
  const plate = listingPlate(nodes, zone)
  if (!plate) return null
  const alone = !(plate.zoneIds ?? []).some((id) => id !== zoneId && isGroundRoom(nodes[id]))
  return alone ? plate : null
}

/**
 * The shared floor beside a room on a separate floor, where it goes back to.
 * For a room on the shared floor, its own plate.
 */
export function roomSharedFootprint(nodes: Nodes, zoneId: string): SlabNode | null {
  const zone = nodes[zoneId]
  if (!isRoom(zone) || !zone.parentId) return null
  if (!zone.floor?.footprint) return listingPlate(nodes, zone)
  const shared = roomFloorChoices(nodes, zoneId).find((choice) => choice.key === null)
  const plate = shared ? nodes[shared.plateId] : undefined
  return plate?.type === 'slab' ? plate : null
}

export type RoomBuiltOnModel = {
  /** The floor the room stands on (checked in the picker). */
  current: PlateChoice
  /** Every floor it can stand on, the current one first. */
  choices: FloorChoice[]
  /** The shared floor beside a room on a separate floor, when one touches it. */
  shared: PlateChoice | null
}

/**
 * What the "Built on" picker shows, or null when it has nothing to offer: a
 * mezzanine, a room whose floor is a drawn slab, and a room on the shared
 * floor alone on its footprint with no other floor touching it. A room on a
 * separate floor can always go back to the shared floor, touching one or not.
 */
export function roomBuiltOn(nodes: Nodes, zoneId: string): RoomBuiltOnModel | null {
  const zone = nodes[zoneId]
  if (!isGroundRoom(zone)) return null
  if (roomDrawnFloor(nodes, zoneId)) return null
  const choices = roomFloorChoices(nodes, zoneId)
  const plate = listingPlate(nodes, zone)
  const current = plate && choices.find((choice) => choice.plateId === plate.id)
  if (!plate || !current) return null
  const key = current.key
  const alone = !(plate.zoneIds ?? []).some((id) => id !== zoneId && isGroundRoom(nodes[id]))
  if (key === null && alone && choices.length === 1) return null
  const sharedPlate = key === null ? null : roomSharedFootprint(nodes, zoneId)
  const shared = sharedPlate
    ? (choices.find((choice) => choice.plateId === sharedPlate.id) ?? null)
    : null
  const offersShared = choices.some((choice) => choice.key === null)
  return { current, choices: offersShared ? choices : [...choices, SHARED_FLOOR], shared }
}

/**
 * The Floor row's line for a room on a separate floor: "Lanai floor · 0.15 m
 * below Shared floor", "… above …", or "… level with …", `offset` being the
 * step from the shared floor's walking surface to the room's
 * (`separateFloorOffset`).
 */
export function separateFloorSummary(
  model: { current: { name: string }; shared: { name: string } | null; offset: number | null },
  length: (meters: number) => string,
): string {
  const { current, shared, offset } = model
  if (!shared || offset === null) return current.name
  if (Math.abs(offset) < 0.005) return `${current.name} · level with ${shared.name}`
  return `${current.name} · ${length(Math.abs(offset))} ${offset > 0 ? 'above' : 'below'} ${shared.name}`
}
