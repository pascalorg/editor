import {
  lengthOnEdges,
  OPEN_PLAN_ROOMS,
  outlineEdges,
  overlapOnEdge,
  type RoomType,
  roomArea,
  roomGap,
  roomWidth,
  type UnitLayout,
  type UnitRoom,
  type UnitSpace,
  WET_ROOMS,
} from './unit-layout'

/**
 * What a judge reads about a layout: facts that code has already measured and judged against
 * thresholds ("the living room is small, 15 m²"), never raw dimensions to weigh. A fast judge
 * weighs facts well and does arithmetic badly. `key` is the fact's stable name; `text` is how it
 * is said.
 */

export type ObservationLevel = 'good' | 'neutral' | 'concern'
export type Observation = { key: string; level: ObservationLevel; text: string }

/** Metres and m², at the wall centrelines. */
export const OBSERVE = {
  livingSmall: 18,
  livingGenerous: 24,
  livingDaylight: 3,
  bedroomDaylight: 2.5,
  /** The narrowest window the generator draws; less outside wall leaves a bedroom dark. */
  bedroomWindow: 0.9,
  /** B2's bedroom 1 measures 2.66 m: a real, narrow-ish bedroom. */
  bedroomNarrow: 2.7,
  bedroomSmall: 9,
  bathroomTight: 3.6,
  kitchenWindow: 0.9,
  /** B2's halls and entry take ~19% of its floor. */
  circulationLot: 0.22,
  circulationCompact: 0.12,
  longNarrow: 2.2,
  wetSpread: 3,
  oversized: { laundry: 3, pantry: 2, closet: 2.5, walk_in: 6 } as Partial<
    Record<RoomType, number>
  >,
}

const LABEL: Record<RoomType, string> = {
  living: 'living room',
  kitchen: 'kitchen',
  hall: 'hall',
  entry: 'entry hall',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  walk_in: 'walk-in closet',
  closet: 'closet',
  pantry: 'pantry',
  laundry: 'laundry',
}

const m2 = (v: number) => `${Math.round(v * 10) / 10} m²`
const m = (v: number) => `${Math.round(v * 10) / 10} m`

function aspect(room: UnitRoom) {
  const xs = room.rects.flatMap((r) => [r[0], r[2]])
  const zs = room.rects.flatMap((r) => [r[1], r[3]])
  const w = Math.max(...xs) - Math.min(...xs)
  const d = Math.max(...zs) - Math.min(...zs)
  return Math.max(w, d) / Math.max(1e-6, Math.min(w, d))
}

/** How many distinct outside edges a room has a window run on. */
function daylightSides(room: UnitRoom, space: UnitSpace) {
  return outlineEdges(space).filter(
    (edge) =>
      edge.kind === 'outside' &&
      room.rects.some((r) => {
        const o = overlapOnEdge(r, edge)
        return !!o && Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) >= 0.9
      }),
  ).length
}

export function observeLayout(layout: UnitLayout, space: UnitSpace): Observation[] {
  const t = OBSERVE
  const rooms = layout.rooms
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const count = (type: RoomType) => rooms.filter((r) => r.type === type).length
  const name = (room: UnitRoom) => {
    const index = rooms.filter((r) => r.type === room.type).indexOf(room) + 1
    return count(room.type) > 1 ? `${LABEL[room.type]} ${index}` : LABEL[room.type]
  }
  const Name = (room: UnitRoom) => name(room).replace(/^./, (c) => c.toUpperCase())
  /** "the kitchen", but "bathroom 2". */
  const the = (room: UnitRoom) => (count(room.type) > 1 ? name(room) : `the ${name(room)}`)
  const The = (room: UnitRoom) => the(room).replace(/^./, (c) => c.toUpperCase())
  const window = (room: UnitRoom) => lengthOnEdges(room.rects, space, ['outside'])
  const doorsOf = (room: UnitRoom) =>
    layout.doors
      .filter((d) => d.rooms.includes(room.id))
      .map((d) => byId.get(d.rooms.find((id) => id !== room.id)!)!)
  const openTo = (room: UnitRoom) =>
    layout.open
      .filter((p) => p.includes(room.id))
      .map((p) => byId.get(p.find((id) => id !== room.id)!)!)
  const out: Observation[] = []
  const say = (key: string, level: ObservationLevel, text: string) => out.push({ key, level, text })

  const living = rooms.find((r) => r.type === 'living')
  if (living) {
    const area = roomArea(living)
    if (area >= t.livingGenerous)
      say('living_size', 'good', `The living room is generous (${m2(area)}).`)
    else if (area >= t.livingSmall)
      say('living_size', 'neutral', `The living room is a good size (${m2(area)}).`)
    else
      say(
        'living_size',
        'concern',
        `The living room is small (${m2(area)}), under the ${t.livingSmall} m² this home needs.`,
      )
    const sides = daylightSides(living, space)
    const run = window(living)
    if (sides >= 2) say('living_daylight', 'good', 'The living room has windows on two sides.')
    else if (run >= t.livingDaylight)
      say('living_daylight', 'neutral', `The living room has a good run of windows (${m(run)}).`)
    else if (run > 0)
      say(
        'living_daylight',
        'concern',
        `The living room has only a short stretch of window (${m(run)}).`,
      )
    else say('living_daylight', 'concern', 'The living room has no window.')
    if (aspect(living) > t.longNarrow)
      say('long_narrow', 'concern', 'The living room is long and narrow.')
  }

  const kitchen = rooms.find((r) => r.type === 'kitchen')
  if (kitchen) {
    say(
      'kitchen_window',
      window(kitchen) >= t.kitchenWindow ? 'good' : 'neutral',
      window(kitchen) >= t.kitchenWindow
        ? 'The kitchen has a window.'
        : 'The kitchen has no window.',
    )
    if (living && openTo(kitchen).includes(living))
      say('kitchen_living', 'good', 'The kitchen is open-plan to the living room.')
    else if (living && doorsOf(kitchen).includes(living))
      say('kitchen_living', 'neutral', 'The kitchen opens off the living room.')
    else say('kitchen_living', 'concern', 'The kitchen is not next to the living room.')
  }

  const entry = byId.get(layout.entry.room)
  if (entry)
    say(
      'entry_into',
      entry.type === 'living' || entry.type === 'kitchen' ? 'concern' : 'good',
      entry.type === 'entry'
        ? 'The front door opens into an entry hall.'
        : entry.type === 'hall'
          ? 'The front door opens into a hall.'
          : `The front door opens straight into the ${LABEL[entry.type]}.`,
    )

  for (const bedroom of rooms.filter((r) => r.type === 'bedroom')) {
    const via = doorsOf(bedroom).find((r) => OPEN_PLAN_ROOMS.has(r.type))
    if (via && (via.type === 'living' || via.type === 'kitchen'))
      say('bedroom_exposed', 'concern', `${Name(bedroom)} opens off the ${LABEL[via.type]}.`)
    else if (via)
      say('bedroom_private', 'good', `${Name(bedroom)} opens off the ${LABEL[via.type]}.`)
    const run = window(bedroom)
    if (run >= t.bedroomDaylight)
      say('bedroom_daylight', 'good', `${Name(bedroom)} has a good window wall.`)
    else if (run >= t.bedroomWindow)
      say('bedroom_daylight', 'concern', `${Name(bedroom)} has only a small window (${m(run)}).`)
    else if (run > 0)
      say(
        'bedroom_dark',
        'concern',
        `${Name(bedroom)} has no room for a window (${m(run)} of outside wall).`,
      )
    else say('bedroom_dark', 'concern', `${Name(bedroom)} has no window.`)
    const width = roomWidth(bedroom)
    const area = roomArea(bedroom)
    if (width < t.bedroomNarrow)
      say('bedroom_narrow', 'concern', `${Name(bedroom)} is narrow (${m(width)} wide).`)
    else if (area < t.bedroomSmall)
      say('bedroom_small', 'concern', `${Name(bedroom)} is small (${m2(area)}).`)
    if (aspect(bedroom) > t.longNarrow)
      say('long_narrow', 'concern', `${Name(bedroom)} is long and narrow.`)
  }

  for (const bath of rooms.filter((r) => r.type === 'bathroom')) {
    const via = doorsOf(bath)
    const suite = via.find((r) => r.type === 'bedroom')
    if (via.some((r) => r.type === 'living' || r.type === 'kitchen'))
      say('bathroom_exposed', 'concern', `${Name(bath)} opens off the living space.`)
    else if (suite) say('bathroom_ensuite', 'good', `${Name(bath)} is en-suite to ${name(suite)}.`)
    else if (via.length) {
      const access = via.find((r) => OPEN_PLAN_ROOMS.has(r.type)) ?? via[0]!
      say('bathroom_shared', 'neutral', `${Name(bath)} opens off ${the(access)}.`)
    }
    if (roomArea(bath) < t.bathroomTight)
      say('bathroom_tight', 'concern', `${Name(bath)} is tight (${m2(roomArea(bath))}).`)
  }

  for (const room of rooms) {
    const cap = t.oversized[room.type]
    if (cap !== undefined && roomArea(room) > cap)
      say('oversized', 'concern', `${The(room)} is oversized for its use (${m2(roomArea(room))}).`)
  }

  const total = rooms.reduce((s, r) => s + roomArea(r), 0)
  const circulation =
    rooms
      .filter((r) => r.type === 'hall' || r.type === 'entry')
      .reduce((s, r) => s + roomArea(r), 0) / total
  if (circulation > t.circulationLot)
    say(
      'circulation',
      'concern',
      `Halls and the entry take a lot of floor (${Math.round(circulation * 100)}%).`,
    )
  else if (circulation <= t.circulationCompact)
    say('circulation', 'good', 'Halls and the entry are compact.')
  else say('circulation', 'neutral', 'Halls and the entry take a reasonable share of the floor.')

  // Through rooms: the room before each one on the way in from the front door.
  const before = new Map<string, UnitRoom | null>([[layout.entry.room, null]])
  const queue = [layout.entry.room]
  while (queue.length) {
    const room = byId.get(queue.shift()!)
    if (!room) continue
    for (const next of [...openTo(room), ...doorsOf(room)])
      if (!before.has(next.id)) {
        before.set(next.id, room)
        queue.push(next.id)
      }
  }
  for (const room of rooms) {
    const via = before.get(room.id)
    if (!via || OPEN_PLAN_ROOMS.has(via.type)) continue
    const suite =
      via.type === 'bedroom' &&
      (room.type === 'walk_in' || room.type === 'bathroom' || room.type === 'closet')
    if (!suite)
      say('through_room', 'concern', `To reach ${the(room)} you walk through ${the(via)}.`)
  }

  const wet = rooms.filter((r) => WET_ROOMS.has(r.type))
  if (wet.length > 1) {
    const spread = Math.max(
      ...wet.map((r) => Math.min(...wet.filter((o) => o !== r).map((o) => roomGap(r, o)))),
    )
    say(
      'wet_rooms',
      spread > t.wetSpread ? 'concern' : 'neutral',
      spread > t.wetSpread
        ? `The kitchen and bathrooms are spread apart (up to ${m(spread)}).`
        : 'The kitchen and bathrooms are grouped.',
    )
  }
  return out
}
