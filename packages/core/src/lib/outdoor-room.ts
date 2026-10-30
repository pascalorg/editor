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
