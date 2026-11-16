import type { ZoneNode } from '../schema'
import { DEFAULT_DECK_BOARDS, deckBoardThickness } from './deck-boards'

/**
 * Rooms outside the house, the outdoor room types: a porch (a covered floor a step
 * down from the house), a deck (a framed floor of boards) and a patio (an uncovered slab). A room
 * of one of these types is outdoors whatever covers it, so the house walls it faces are exterior
 * walls even under a porch ceiling, and its floor steps down from the house's (`floor.drop`).
 *
 * A room closed off outside the house by invisible walls starts as a porch: its floor a concrete
 * slab 1.5 in under the house's and its ceiling at the house's, both adjustable in its panel.
 */

const IN = 0.0254

export const OUTDOOR_ROOM_TYPES = ['porch', 'deck', 'patio'] as const
export type OutdoorRoomType = (typeof OUTDOOR_ROOM_TYPES)[number]

/** A porch or patio slab steps down from the house's finish floor by 1.5 in at most. */
export const PORCH_FLOOR_DROP = 1.5 * IN
/** Deck boards ride 1 in under the threshold so water sheds away from the door. */
export const DECK_FLOOR_DROP = 1 * IN
/**
 * The deck boards on a deck's floor unless its room says otherwise (5/4x6, 1 in: `lib/deck-boards`);
 * the framing hangs under them.
 */
export const DECKING_THICKNESS = deckBoardThickness(DEFAULT_DECK_BOARDS)

export type OutdoorRoomDefaults = {
  /** The name a room of the type is given while it has a default name. */
  name: string
  drop: number
  /** The floor finish it starts with. */
  finish: string
  /** Whether it has a ceiling (a covered porch). */
  covered: boolean
  /** How the framing plugin reads its floor plate (`metadata.floor`). */
  floorTag: 'porch-slab' | 'deck'
}

export const OUTDOOR_ROOM_DEFAULTS: Record<OutdoorRoomType, OutdoorRoomDefaults> = {
  porch: {
    name: 'Porch',
    drop: PORCH_FLOOR_DROP,
    finish: 'library:concrete-raw',
    covered: true,
    floorTag: 'porch-slab',
  },
  deck: {
    name: 'Deck',
    drop: DECK_FLOOR_DROP,
    finish: 'library:wood-woodfine11',
    covered: false,
    floorTag: 'deck',
  },
  patio: {
    name: 'Patio',
    drop: PORCH_FLOOR_DROP,
    finish: 'library:concrete-raw',
    covered: false,
    floorTag: 'porch-slab',
  },
}

export function isOutdoorRoomType(value: unknown): value is OutdoorRoomType {
  return typeof value === 'string' && (OUTDOOR_ROOM_TYPES as readonly string[]).includes(value)
}

/** Whether a room is one of the outdoor room types. */
export function isOutdoorRoom(zone: Pick<ZoneNode, 'roomType'>): boolean {
  return isOutdoorRoomType(zone.roomType)
}

/** A room zone, as the lighting enclosure tests read it (type, placement and boundary separators). */
type RoomZoneLike = {
  type?: string
  id?: string
  parentId?: string | null
  spaceRole?: string
  roomType?: string
  enclosureStatus?: string
  autoFromWalls?: boolean
  boundarySeparatorIds?: readonly string[]
}

/**
 * Whether a room is open to the outside, so it should be lit and metered as outdoors — not as a
 * sealed interior — however it is covered. A covered porch, a deck, a patio, a room marked `open`,
 * or a room left open on a side (a wall switched off, a floor with no wall there) all read as open
 * air. A hand-drawn zone marked `enclosed` never does.
 *
 * The signal is the room's boundary separators (the open sides the room panel counts): a separator
 * two rooms share is an interior threshold between them, so a room is open to the outside only when
 * it has a separator that no other room on its level lists. A room found from walls carries
 * `enclosed` whenever its boundary loop closes — open sides included — so that stamp says nothing
 * about walls and is not read here.
 */
export function isOpenAirRoom(
  nodes: Record<string, RoomZoneLike | undefined>,
  zone: RoomZoneLike,
): boolean {
  if (isOutdoorRoomType(zone.roomType)) return true
  if (zone.enclosureStatus === 'open') return true
  if (zone.enclosureStatus === 'enclosed' && !zone.autoFromWalls) return false
  const separators = zone.boundarySeparatorIds ?? []
  if (separators.length === 0) return false
  const shared = new Set<string>()
  for (const id in nodes) {
    const other = nodes[id]
    if (
      other?.type !== 'zone' ||
      other.id === zone.id ||
      other.parentId !== zone.parentId ||
      other.spaceRole !== 'room'
    )
      continue
    for (const sep of other.boundarySeparatorIds ?? []) shared.add(sep)
  }
  return separators.some((sep) => !shared.has(sep))
}

/**
 * Indoor rooms joined by an open side into one open-plan space, so the lighting lights each group as
 * one room (a shared light set, no seam where an open threshold cuts a nook off a larger room)
 * rather than giving the nook its own imagined ceiling light. Keyed by zone id → a stable group id
 * (the lowest member id); only rooms that share a group with another appear. Open-air rooms are left
 * out — they are lit as outdoors — so an indoor room open onto a porch is never merged with it.
 *
 * Two indoor rooms are in one group when they list the same boundary separator (an open side with no
 * wall between them); the relation is transitive, so a run of open-plan rooms becomes one group.
 */
export function openPlanRoomGroups(
  nodes: Record<string, RoomZoneLike | undefined>,
): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    while (parent.get(x) !== root) {
      const next = parent.get(x)!
      parent.set(x, root)
      x = next
    }
    return root
  }
  const join = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Keep the lower id as the root so the group id is stable across rebuilds.
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }
  const rooms: { id: string; seps: readonly string[] }[] = []
  for (const id in nodes) {
    const z = nodes[id]
    if (z?.type !== 'zone' || z.spaceRole !== 'room' || isOpenAirRoom(nodes, z)) continue
    const zid = z.id ?? id
    parent.set(zid, zid)
    rooms.push({ id: zid, seps: z.boundarySeparatorIds ?? [] })
  }
  // A separator is one node on one level, so rooms that list it are adjacent across that open side.
  const bySeparator = new Map<string, string[]>()
  for (const room of rooms)
    for (const sep of room.seps) {
      const list = bySeparator.get(sep)
      if (list) list.push(room.id)
      else bySeparator.set(sep, [room.id])
    }
  for (const ids of bySeparator.values())
    for (let i = 1; i < ids.length; i++) join(ids[0]!, ids[i]!)
  const groups = new Map<string, string>()
  for (const room of rooms) {
    const root = find(room.id)
    // Only rooms actually merged with another carry a group; singletons stay implicit.
    if (root !== room.id || rooms.some((r) => r.id !== room.id && find(r.id) === root))
      groups.set(room.id, root)
  }
  return groups
}

/** "Porch", "Porch 2", …: the next free name for a room of `type` among `names`. */
export function nextOutdoorRoomName(type: OutdoorRoomType, names: Iterable<string>): string {
  const base = OUTDOOR_ROOM_DEFAULTS[type].name
  const taken = new Set(names)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** Whether `name` is a type's default name ("Deck", "Deck 3"), so a type change may rename it. */
export function isOutdoorRoomDefaultName(name: string | undefined): boolean {
  return (
    typeof name === 'string' &&
    OUTDOOR_ROOM_TYPES.some((type) =>
      new RegExp(`^${OUTDOOR_ROOM_DEFAULTS[type].name}( \\d+)?$`).test(name),
    )
  )
}
