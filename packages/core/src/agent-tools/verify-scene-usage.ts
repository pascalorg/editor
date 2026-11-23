import { USAGE_INDICATORS } from '../building/code-profile'

/**
 * How `verify_scene` shows the usage findings to a model: a room's missing turning circle and
 * pocket as one entry for the room, a narrow place as one entry for the rooms it leads to, every
 * other finding whole but without the structure its message and node ids already carry, and the
 * words every entry would repeat once. The report keeps each finding as measured (`usageIssues`);
 * `type` and `room` give them back.
 */

/** The findings a room's one entry holds. */
export const ROOM_FOLDED_TYPES = ['usage_turning_narrow', 'usage_pocket'] as const

/** The type of a narrow passage's finding: one for each place, naming the rooms it leads to. */
export const PASSAGE_TYPE = 'usage_passage_narrow'

/** The type of a room's one entry; asking for it returns the findings it holds. */
export const ROOM_ENTRY_TYPE = 'usage_room'

export const isUsageType = (type: unknown): type is string =>
  typeof type === 'string' && type.startsWith('usage_')

export const isRoomFolded = (type: unknown): boolean =>
  (ROOM_FOLDED_TYPES as readonly unknown[]).includes(type)

type Found = Record<string, unknown>

const isRecord = (value: unknown): value is Found =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const placeOf = (found: Found) => (isRecord(found.place) ? found.place : {})

const roomIdOf = (found: Found) => String(placeOf(found).roomId ?? '')

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const round2 = (value: number) => Math.round(value * 100) / 100

/** A finding's place on the plan to the centimetre, or nothing. */
function atOf(found: Found): [number, number] | undefined {
  const at = placeOf(found).at
  return Array.isArray(at) && typeof at[0] === 'number' && typeof at[1] === 'number'
    ? [round2(at[0]), round2(at[1])]
    : undefined
}

/** The rooms a narrow passage leads to: its `serves`. */
function servedBy(found: Found): { room: string; roomId: string }[] {
  return Array.isArray(found.serves)
    ? found.serves.filter(isRecord).map((room) => ({
        room: String(room.room ?? ''),
        roomId: String(room.roomId ?? ''),
      }))
    : []
}

/** The ids of the rooms a narrow passage leads to. */
export const servedRoomIds = (passages: Found[]) =>
  new Set(passages.flatMap((found) => servedBy(found).map((room) => room.roomId)))

/** The entrances the passages were measured from: said once in the note when there is one, by each entry when there are several. */
export const passageEntrances = (passages: Found[]): string[] => [
  ...new Set(
    passages.flatMap((found) => (typeof found.fromDoor === 'string' ? [found.fromDoor] : [])),
  ),
]

/**
 * One entry per room for its turning circle and pocket findings, in the order the rooms first
 * appear. A pocket that is the room's whole free floor, in a room a narrow passage leads to, says
 * what the passage says (a path under a 0.60 m unit leads nowhere a unit can leave), so the entry
 * does not say it twice and a room with nothing else has none; `count` is every finding it holds.
 */
export function foldUsageRooms(members: Found[], served: ReadonlySet<string>): Found[] {
  const rooms = new Map<string, Found[]>()
  for (const found of members) {
    const key = roomIdOf(found)
    rooms.set(key, [...(rooms.get(key) ?? []), found])
  }
  return [...rooms.entries()].flatMap(([roomId, held]) => {
    const clauses = held
      .filter(
        (found) =>
          !(found.type === 'usage_pocket' && found.wholeRoom === true && served.has(roomId)),
      )
      .map((found) => String(found.brief ?? found.message))
    if (!clauses.length) return []
    const warning = held.some((found) => found.severity !== 'info')
    const first = held[0]!
    return [
      {
        type: ROOM_ENTRY_TYPE,
        severity: warning ? 'warning' : 'info',
        message: `${String(placeOf(first).room ?? '')}: ${clauses.join('; ')}.`,
        nodeIds: [...new Set(held.flatMap((found) => stringsOf(found.nodeIds)))],
        count: held.length,
        ...(held.some((found) => found.approximate === true) ? { approximate: true } : {}),
      },
    ]
  })
}

/** What an entry for one finding keeps: its sentence, its nodes, its measured values and where. */
const KEPT = ['type', 'severity', 'message', 'nodeIds', 'valueM', 'valueM2', 'valueDeg'] as const

/**
 * A usage finding without what its message and node ids already say (obstacles, thresholds, code
 * table row). A narrow place keeps its sentence and the things that bound it: the figure and the
 * rooms are in the sentence, and a room's own findings are asked for by its name.
 */
export function slimUsageFinding(found: Found, entrances: readonly string[] = []): Found {
  if (found.type === PASSAGE_TYPE) {
    const rooms = new Set(servedBy(found).map((room) => room.roomId))
    return {
      type: found.type,
      severity: found.severity,
      message:
        entrances.length < 2 && typeof found.brief === 'string' ? found.brief : found.message,
      nodeIds: stringsOf(found.nodeIds).filter((id) => !rooms.has(id)),
      ...(found.approximate === true ? { approximate: true } : {}),
    }
  }
  const slim: Found = {}
  for (const key of KEPT) if (found[key] !== undefined) slim[key] = found[key]
  if (found.approximate === true) slim.approximate = true
  const at = atOf(found)
  if (at) slim.at = at
  return slim
}

/** The rooms a usage finding is about: its own, and the rooms a narrow passage leads to. */
function roomsOf(found: Found): { room: string; roomId: string }[] {
  return [...servedBy(found), { room: String(placeOf(found).room ?? ''), roomId: roomIdOf(found) }]
}

/** Findings placed in, serving or naming a room or one of its contents, returned whole. */
export function findingsOfRoom(issues: unknown[], room: string, scope: unknown): Found[] {
  const wanted = room.trim().toLowerCase()
  const rooms = Array.isArray(scope)
    ? scope.filter(
        (entry) =>
          isRecord(entry) &&
          [entry.roomId, entry.room].some(
            (name) => typeof name === 'string' && name.trim().toLowerCase() === wanted,
          ),
      )
    : []
  const nodeIds = new Set(rooms.flatMap((entry) => stringsOf(entry.nodeIds)))
  return issues.filter(
    (issue): issue is Found =>
      isRecord(issue) &&
      (roomsOf(issue).some(
        (found) =>
          found.roomId.toLowerCase() === wanted || found.room.trim().toLowerCase() === wanted,
      ) ||
        Object.entries(issue).some(([key, value]) =>
          key.endsWith('Ids')
            ? stringsOf(value).some((id) => nodeIds.has(id))
            : key.endsWith('Id') && typeof value === 'string' && nodeIds.has(value),
        )),
  )
}

/** The rooms that have usage findings, for the answer to a room nothing was found for. */
export function roomsWithUsageFindings(issues: unknown[]): string[] {
  return [
    ...new Set(
      issues.flatMap((issue) =>
        isRecord(issue) && isUsageType(issue.type) ? roomsOf(issue).map((room) => room.room) : [],
      ),
    ),
  ].filter(Boolean)
}

const metres = (value: number) => value.toFixed(2)

/**
 * The words every usage entry would repeat, said once: what a finding is, the thresholds it reads
 * against (the numbers the checks apply; a test holds them to those), and what the entries are.
 */
export function usageNote(measuredFrom: readonly string[] = []): string {
  const { passage, doorClear, turning } = USAGE_INDICATORS
  return [
    'Usage findings are indicators read from the drawn scene, not code checks; a figure from a code names it.',
    `A passage is narrow under ${metres(passage.value)} m (${metres(doorClear.value)} m through a doorway), a turning circle under ${metres(turning.value)} m; a pocket is floor a 0.60 m unit fits on and cannot leave.`,
    'A piece 2 cm into another is a contact, 8 cm a warning; a window is blocked by a piece within 15 cm of the glass and over 30 cm above its sill; a door stopping before 80° is a finding; a bed wants 0.60 m at a side and at the foot. Use defects warn even on approximate shapes.',
    ...(measuredFrom.length
      ? [`Ground-floor passages are measured from “${measuredFrom[0]}”.`]
      : []),
    'A doorway is read between its jambs, and the limit applies to that clear width, not the door as drawn.',
    'A narrow passage is one entry for the place, naming the rooms it leads to; a slot or cupboard on no way to a room has none, a pocket speaks for dead floor. One usage_room entry per room holds its turning circle and pocket.',
  ].join(' ')
}
