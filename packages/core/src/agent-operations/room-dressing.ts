import type { DesignBrief, RoomDressing } from '../agent-tools/design-brief'
import { foldRoomName } from '../building/room-use'

/**
 * The dressing each room of a brief announces, and a later brief of the turn against the first: the
 * kinds of wall dressing (wainscot, chair rail, tiles to height...) a room is announced with, and
 * the finding where a later brief announces less. A brief is free to revise, so it is a fact to
 * show. It never refuses a write.
 */

/** A kind as the brief's words say it, with the article. */
const NOUNS: Record<RoomDressing, string> = {
  wainscot: 'a wainscot',
  chairRail: 'a chair rail',
  crown: 'a crown moulding',
  'tiles-to-height': 'tile part way up the walls',
  'tiles-full': 'tile to the ceiling',
  splashback: 'a splashback',
  accent: 'an accent wall',
}

const sentence = (words: readonly string[]) =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

/** The dressing each room of a brief announces, by the room's folded name. */
export type AnnouncedDressing = Record<string, RoomDressing[]>

export function announcedDressing(
  brief: Pick<DesignBrief, 'rooms'> | null | undefined,
): AnnouncedDressing {
  return Object.fromEntries(
    (brief?.rooms ?? []).flatMap((room) =>
      room.finishes?.dressing?.length
        ? [[foldRoomName(room.name), [...room.finishes.dressing]]]
        : [],
    ),
  )
}

export type DressingRevision = { code: 'room_dressing_revised_simpler'; message: string }

/**
 * The finding where a later brief of the turn announces less dressing for a room than the first
 * did: a kind the first announced for it and the latest no longer does. A brief is free to revise,
 * so this is a fact to show. Null when nothing was dropped or the first announced none.
 */
export function dressingRevision(
  first: AnnouncedDressing | undefined,
  brief: Pick<DesignBrief, 'rooms'> | null | undefined,
): DressingRevision | null {
  if (!first) return null
  const latest = announcedDressing(brief)
  const named = new Map((brief?.rooms ?? []).map((room) => [foldRoomName(room.name), room.name]))
  const dropped = Object.entries(first).flatMap(([room, kinds]) => {
    if (!named.has(room)) return []
    const lost = kinds.filter((kind) => !latest[room]?.includes(kind))
    return lost.length ? [`${named.get(room)}: ${sentence(lost.map((kind) => NOUNS[kind]))}`] : []
  })
  if (!dropped.length) return null
  return {
    code: 'room_dressing_revised_simpler',
    message: `The rooms' dressing was revised during the turn; the brief no longer announces ${dropped.join('; ')}.`,
  }
}
