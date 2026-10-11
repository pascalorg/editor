import type { FURNISHED_ROOM_TYPES } from '../agent-tools/furnish-room'
import type { AssetInput } from '../schema'
import type { LabelRoomType } from './plan-judge'
import type { PlanLabelPlace } from './plan-labels'
import type { PlanSymbol } from './plan-symbols'

/**
 * The catalog items a drawn symbol may be (L53), for the judge to pick one or none from their
 * names. A catalog's sizes are not a plan's (a 2.34 m bathtub for a 1.5 m bath, a 1.8 m vanity for
 * a basin), so size alone misses: the items its room is for come first, then the items nearest
 * its drawn footprint, whichever way round they are modelled. Only items that stand on the floor.
 */

type FurnishedRoomType = (typeof FURNISHED_ROOM_TYPES)[number]
type Pt = [number, number]

/** How many of each: the room's items, then the nearest sizes. */
export const CANDIDATES = { forRoom: 8, nearest: 8 }
/** Each side within this share of the drawn one, an item fits the drawing as it is. */
const FITS = 0.25

/** The catalog's words for what each of furnish_room's room types holds: a category or a tag. */
const ROOM_WORDS: Record<FurnishedRoomType, string[]> = {
  bedroom: ['bedroom'],
  kitchen: ['kitchen'],
  bathroom: ['bathroom'],
  living: ['living', 'lounge'],
  dining: ['dining'],
  hallway: ['hallway'],
  entry: ['entryway'],
  laundry: ['laundry'],
  storage: ['storage'],
}

export type PlanCandidate = {
  assetId: string
  name: string
  category: string
  /** Its footprint, width by depth, in metres. */
  size: Pt
  /** An item its room is for. */
  forRoom: boolean
  /** Each side within 25% of the drawn one: placed as it is, it covers what the plan draws. */
  fits: boolean
}

const sorted = ([a, b]: readonly number[]): Pt => (a! <= b! ? [a!, b!] : [b!, a!])

export function symbolCandidates(
  drawn: readonly [number, number],
  catalog: readonly AssetInput[],
  roomType: FurnishedRoomType | null,
): PlanCandidate[] {
  const [short, long] = sorted(drawn)
  const words = roomType ? ROOM_WORDS[roomType] : []
  const scored = catalog
    .filter((asset) => !asset.attachTo)
    .map((asset) => {
      const [w, , d] = asset.dimensions ?? [1, 1, 1]
      const [s, l] = sorted([w, d])
      return {
        candidate: {
          assetId: asset.id,
          name: asset.name,
          category: asset.category,
          size: [w, d] as Pt,
          forRoom: words.some((word) => asset.category === word || asset.tags?.includes(word)),
          fits: Math.abs(s / short - 1) <= FITS && Math.abs(l / long - 1) <= FITS,
        },
        misfit: Math.abs(Math.log(s / short)) + Math.abs(Math.log(l / long)),
      }
    })
    .sort((a, b) => a.misfit - b.misfit)
  const forRoom = scored.filter((entry) => entry.candidate.forRoom).slice(0, CANDIDATES.forRoom)
  const nearest = scored.filter((entry) => !forRoom.includes(entry)).slice(0, CANDIDATES.nearest)
  return [...forRoom, ...nearest].map((entry) => entry.candidate)
}

/**
 * A symbol's room type: the nearest typed label printed in its room (an open plan prints several;
 * a cupboard's or an appliance's types no room). With no room, or none typed, it is null: the
 * nearest printed word may name the room next door.
 */
export function symbolRoomType(
  symbol: Pick<PlanSymbol, 'room' | 'center'>,
  places: readonly (PlanLabelPlace & { type: LabelRoomType | null })[],
): FurnishedRoomType | null {
  if (!symbol.room) return null
  const distance = (place: PlanLabelPlace) =>
    Math.hypot(place.at[0] - symbol.center[0], place.at[1] - symbol.center[1])
  const nearest = places
    .filter(
      (place): place is PlanLabelPlace & { type: FurnishedRoomType } =>
        !!place.type && place.type !== 'not_a_room' && place.room?.id === symbol.room!.id,
    )
    .sort((a, b) => distance(a) - distance(b))[0]
  return nearest?.type ?? null
}
