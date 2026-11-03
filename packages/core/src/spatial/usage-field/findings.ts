import {
  type CodeProfileId,
  type ThresholdSource,
  USAGE_INDICATORS,
} from '../../building/code-profile'
import type { AnyNode, DoorNode, ItemNode } from '../../schema'
import { bedIssues } from './beds'
import { blockedOpeningIssues } from './blocked'
import { clashIssues } from './clash'
import { doorOverStairIssues } from './door-stairs'
import { entryIssues } from './entry-way'
import { fixtureClearanceIssues } from './fixtures'
import { m, nameOf, quote, unique } from './labels'
import {
  type MeasureOptions,
  measureUsage,
  type ObstacleRef,
  type Passage,
  type RoomMeasure,
} from './measure'
import { usageShapes } from './shapes'
import { doorSwingIssues } from './swings'
import type { Nodes } from './walls'

/** Clear width of a path in a house: 0,90 m, the arrêté du 24 décembre 2015 art. 11 II (36 in is the IRC hall). */
export const PASSAGE_M = USAGE_INDICATORS.passage.value
/** Clear width through an interior door: 32 in; the same arrêté art. 11 II asks 0,80 m nominal and 0,77 m clear. */
export const DOOR_M = USAGE_INDICATORS.doorClear.value
/** Wheelchair turning space: 1.50 m (arrêté du 24 décembre 2015 art. 13; ADA 304.3). */
export const TURNING_M = USAGE_INDICATORS.turning.value
/** One unit of passage: 0.60 m (a clearance of 0.30 m); a pocket smaller than this is not worth a finding. */
export const POCKET_MIN_M2 = 0.36
/** A reading within this of its threshold is the threshold. */
export const TOLERANCE_M = 0.005
/** Rooms whose passages are the same pinch: the same things bound it, a figure within this, a spot within `PLACE_AT_M`. */
export const PLACE_WIDTH_M = 0.005
const PLACE_AT_M = 0.5

export type UsageObstacle = {
  nodeId: string
  name: string
  kind: string
  shape: 'exact' | 'approx'
  movable: boolean
}

export type UsageIssue = {
  type:
    | 'usage_passage_narrow'
    | 'usage_turning_narrow'
    | 'usage_pocket'
    | 'usage_clash'
    | 'usage_opening_blocked'
    | 'usage_door_swing'
    | 'usage_entry_narrow'
    | 'usage_door_over_stair'
    | 'usage_fixture_clearance'
    | 'usage_bed_clearance'
  message: string
  /** Use defects warn even on approximate shapes; measurements and unassigned code checks inform. */
  severity: 'warning' | 'info'
  nodeIds: string[]
  valueM?: number
  valueM2?: number
  thresholdM?: number
  /** A door's free swing, and the 90 degrees it should have. */
  valueDeg?: number
  thresholdDeg?: number
  /** For a finding that applies a code: which one, the section, whether its text was read, and whether the project named it or it is the default US IRC applied to a project that names none. */
  code?: { profile: CodeProfileId; cite: string; source: ThresholdSource; byDefault: boolean }
  place: { room: string; roomId: string; at: [number, number] }
  obstacles: UsageObstacle[]
  fromDoorId?: string
  /** A passage: every room the way through this place leads to, each with the best other exterior door when that reaches it more widely. */
  serves?: { room: string; roomId: string; alternative?: { doorId: string; widthM: number } }[]
  /** A doorway between its jambs: the door as drawn, where `valueM` is the clear width between the jambs. */
  doorWidthM?: number
  /** The name of the door a passage was measured from (the ground floor's entrance), when there is one. */
  fromDoor?: string
  /** What the model's answer says of the finding when the note carries the rest: a room entry's clause for a turning circle and a pocket, a passage's sentence without the entrance (`verify-scene-usage`). */
  brief?: string
  /** A pocket that is the whole room's free floor: the room cannot be left by a 0.60 m unit at all. */
  wholeRoom?: boolean
  approximate: boolean
}

const MOVABLE = /chair|stool|bedside|night ?stand|ottoman|pouf/i

function describe(nodes: Nodes, refs: ObstacleRef[]): UsageObstacle[] {
  return refs.map((ref) => {
    const node = nodes[ref.nodeId]
    const label =
      ref.kind === 'void'
        ? 'stairwell opening'
        : ref.kind === 'stair-rail'
          ? `${nameOf(nodes, ref.nodeId)} railing`
          : nameOf(nodes, ref.nodeId)
    return {
      nodeId: ref.nodeId,
      name: label,
      kind: ref.kind,
      shape: ref.shape,
      movable:
        node?.type === 'item' &&
        MOVABLE.test(`${(node as ItemNode).asset.id} ${(node as ItemNode).asset.name}`),
    }
  })
}

/** The things a finding names, once each: the two parts of one door frame are that door, not two things. */
const distinctOf = (items: UsageObstacle[]) =>
  items.filter((item, at) => items.findIndex((o) => o.nodeId === item.nodeId) === at)

/** The door whose two frame members are the pinch: it is passed through, not against. */
const framedBy = (items: UsageObstacle[]) => {
  const distinct = distinctOf(items)
  return distinct.length === 1 && items.length >= 2 && distinct[0]!.kind === 'jamb'
    ? distinct[0]!
    : null
}

function between(items: UsageObstacle[]): string {
  const distinct = distinctOf(items)
  if (distinct.length >= 2)
    return ` between ${quote(distinct[0]!.name)} and ${quote(distinct[1]!.name)}`
  if (distinct.length === 1) return ` against ${quote(distinct[0]!.name)}`
  return ''
}

const beside = (items: UsageObstacle[]) => {
  const distinct = distinctOf(items)
  return distinct.length ? `, beside ${distinct.map((item) => quote(item.name)).join(' and ')}` : ''
}

const listOf = (names: string[]) =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

type Narrow = {
  room: RoomMeasure
  passage: Passage
  sides: UsageObstacle[]
  limit: number
  doorway: boolean
}

/** The room's narrow passage, with what bounds it and the limit it is read against; null when it is not narrow. */
function narrowPassage(nodes: Nodes, room: RoomMeasure): Narrow | null {
  const passage = room.passage
  if (!passage) return null
  const sides = describe(nodes, passage.by)
  // a pinch between two door-frame members is a doorway, and a doorway needs 0.80 m, not 0.90 m
  const doorway = passage.by.some((o) => o.kind === 'jamb')
  const limit = doorway ? DOOR_M : PASSAGE_M
  return passage.width < limit - TOLERANCE_M ? { room, passage, sides, limit, doorway } : null
}

const sameStuff = (a: UsageObstacle[], b: UsageObstacle[]) => {
  const ids = (items: UsageObstacle[]) => [...new Set(items.map((o) => o.nodeId))].sort().join('|')
  return ids(a) === ids(b)
}

/**
 * One finding for each place a way is narrow, however many rooms it leads to: the rooms whose
 * narrowest point is the same pinch (the same things bound it, the same width, the same spot) are
 * its `serves`, each with the best other exterior door when that reaches it more widely.
 */
function passageIssues(nodes: Nodes, rooms: RoomMeasure[]): UsageIssue[] {
  const places: Narrow[][] = []
  for (const room of rooms) {
    const narrow = narrowPassage(nodes, room)
    if (!narrow) continue
    const place = places.find(([first]) => {
      const a = first!.passage
      const b = narrow.passage
      return (
        sameStuff(first!.sides, narrow.sides) &&
        Math.abs(a.width - b.width) <= PLACE_WIDTH_M &&
        Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) <= PLACE_AT_M
      )
    })
    if (place) place.push(narrow)
    else places.push([narrow])
  }
  return places.map((members) => passageIssue(nodes, members))
}

function passageIssue(nodes: Nodes, members: Narrow[]): UsageIssue {
  const narrowest = members.reduce((best, n) => (n.passage.width < best.passage.width ? n : best))
  const { passage, sides, limit, doorway } = narrowest
  const door = passage.fromDoorId ? nameOf(nodes, passage.fromDoorId) : null
  const approximate = passage.by.some((o) => o.shape === 'approx')
  const target = (room: RoomMeasure) =>
    room.kind === 'stair-foot'
      ? `the foot of ${quote(room.name.replace(/^Foot of /, ''))}`
      : quote(room.name)
  // the best other exterior door, said once when it is the same for every room and by room when it is not
  const first = members[0]!.room.alternative
  const shared =
    first &&
    members.every(
      ({ room }) =>
        room.alternative?.doorId === first.doorId && room.alternative.width === first.width,
    )
      ? first
      : null
  const alternativeOf = (alternative: { doorId: string; width: number }) =>
    `${m(alternative.width)} m from ${quote(nameOf(nodes, alternative.doorId))}`
  const targets = listOf(
    members.map(({ room }) =>
      !shared && room.alternative
        ? `${target(room)} (${alternativeOf(room.alternative)})`
        : target(room),
    ),
  )
  // a doorway is read between its jambs; the door as drawn is said beside it
  const frame = framedBy(sides)
  const drawn = frame ? (nodes[frame.nodeId] as DoorNode | undefined)?.width : undefined
  const clause = `${
    frame
      ? `${m(passage.width)} m clear between the jambs of ${quote(frame.name)}${typeof drawn === 'number' ? `, a ${m(drawn)} m door` : ''}`
      : `${m(passage.width)} m${between(sides)}`
  }${shared ? `; ${alternativeOf(shared)}` : ''}`
  const sentence = `${targets}: ${clause}`
  // a leaf drawn at least the doorway's 0.80 m is a standard door: what it leaves is information
  const standardLeaf = typeof drawn === 'number' && drawn >= DOOR_M - TOLERANCE_M ? drawn : null
  const tail =
    standardLeaf === null
      ? ` (below ${m(limit)} m${doorway ? ', a doorway' : ''}).`
      : ` (a ${m(standardLeaf)} m door leaf: the frame leaves ${m(passage.width)} m clear).`
  const lead = members[0]!.room
  return {
    type: 'usage_passage_narrow',
    message: `Narrow passage to ${sentence}${door ? `, measured from ${quote(door)}` : ''}${tail}`,
    brief: `Passage to ${sentence}${tail}`,
    ...(door ? { fromDoor: door } : {}),
    severity: standardLeaf === null ? 'warning' : 'info',
    nodeIds: unique([
      ...members.map(({ room }) => (room.roomId.startsWith('zone_') ? room.roomId : undefined)),
      ...sides.map((s) => s.nodeId),
    ]),
    valueM: passage.width,
    thresholdM: limit,
    ...(typeof drawn === 'number' ? { doorWidthM: drawn } : {}),
    place: { room: lead.name, roomId: lead.roomId, at: passage.at },
    obstacles: sides,
    ...(passage.fromDoorId ? { fromDoorId: passage.fromDoorId } : {}),
    serves: members.map(({ room }) => ({
      room: room.name,
      roomId: room.roomId,
      ...(room.alternative
        ? { alternative: { doorId: room.alternative.doorId, widthM: room.alternative.width } }
        : {}),
    })),
    approximate,
  }
}

function turningIssue(room: RoomMeasure): UsageIssue | null {
  const turning = room.turning
  if (!turning || !(turning.diameter < TURNING_M - TOLERANCE_M)) return null
  return {
    type: 'usage_turning_narrow',
    message: `No ${m(TURNING_M)} m turning circle in ${quote(room.name)}: largest ${m(turning.diameter)} m.`,
    brief: `no ${m(TURNING_M)} m turning circle, largest ${m(turning.diameter)} m`,
    // A turning circle measures the room, not a defect of a piece: it informs, exact outline or not.
    severity: 'info',
    nodeIds: [room.roomId],
    valueM: turning.diameter,
    thresholdM: TURNING_M,
    place: { room: room.name, roomId: room.roomId, at: turning.at },
    obstacles: [],
    approximate: turning.approximate,
  }
}

function pocketIssue(nodes: Nodes, room: RoomMeasure, from: string): UsageIssue | null {
  const pocket = room.pocket
  if (!(pocket.isolatedM2 >= POCKET_MIN_M2) || !pocket.at) return null
  const around = describe(nodes, pocket.by)
  const approximate = pocket.by.some((o) => o.shape === 'approx')
  const brief = pocket.whole
    ? `no 0.60 m way out from ${from} (${m(pocket.isolatedM2)} m²)`
    : `${m(pocket.isolatedM2)} m² of floor with no 0.60 m way out${beside(around)}`
  return {
    type: 'usage_pocket',
    message: `${quote(room.name)}: ${brief}.`,
    brief,
    ...(pocket.whole ? { wholeRoom: true } : {}),
    severity: 'warning',
    nodeIds: unique([room.roomId, ...around.map((o) => o.nodeId)]),
    valueM2: pocket.isolatedM2,
    place: { room: room.name, roomId: room.roomId, at: pocket.at },
    obstacles: around,
    approximate,
  }
}

/**
 * The usage findings of a scene: narrow passages (measured from the chosen entrance, one for each
 * place that is narrow with the rooms it leads to, and the best other door as a fact), missing turning circles, floor a 0.60 m unit cannot get out of, wall
 * objects that stand out into circulation, pieces inside something solid, what stands in front of a
 * window or a door, a bed's room, a room's headroom and its ceiling. Every threshold is an indicator,
 * not a compliance check.
 */
export function usageIssues(nodes: Nodes, options: MeasureOptions = {}): UsageIssue[] {
  const shapes = usageShapes(nodes)
  const measure = measureUsage(nodes, shapes, options)
  const issues: UsageIssue[] = []
  for (const group of measure.groups) {
    const from = group.source.kind === 'door' ? 'the entrance' : 'the stair arrival'
    const rooms = group.rooms
    const stuck = rooms.filter((room) => room.kind === 'room' && room.pocket.freeM2 > 0)
    // a whole floor cut off from where it is entered is one finding, not one per room
    const wholeFloor =
      stuck.length > 1 && stuck.every((room) => room.pocket.whole) && group.source.kind !== 'none'
    if (wholeFloor) {
      const level = nodes[group.levelId] as
        | (AnyNode & { name?: string; level?: number })
        | undefined
      const area = stuck.reduce((sum, room) => sum + room.pocket.isolatedM2, 0)
      issues.push({
        type: 'usage_pocket',
        message: `${quote(String(level?.name ?? `Level ${level?.level ?? ''}`))}: no 0.60 m way out from ${from} (${m(area)} m²).`,
        brief: `no 0.60 m way out from ${from} (${m(area)} m²)`,
        wholeRoom: true,
        severity: 'warning',
        nodeIds: unique([group.levelId, ...stuck.map((room) => room.roomId)]),
        valueM2: Math.round(area * 1000) / 1000,
        place: { room: String(level?.name ?? 'Level'), roomId: group.levelId, at: stuck[0]!.at },
        obstacles: [],
        approximate: false,
      })
    }
    issues.push(...passageIssues(nodes, rooms))
    for (const room of rooms) {
      const turning = turningIssue(room)
      if (turning) issues.push(turning)
      if (!wholeFloor) {
        const pocket = pocketIssue(nodes, room, from)
        if (pocket) issues.push(pocket)
      }
    }
  }
  issues.push(
    ...clashIssues(nodes, shapes),
    ...blockedOpeningIssues(nodes, shapes),
    ...doorSwingIssues(nodes, shapes),
    ...entryIssues(nodes, shapes),
    ...doorOverStairIssues(nodes, shapes),
    ...fixtureClearanceIssues(nodes, shapes),
    ...bedIssues(nodes, shapes),
  )
  return issues
}
