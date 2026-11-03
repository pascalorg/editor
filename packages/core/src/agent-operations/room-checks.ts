import { isSkirtedRoomUse, isWetRoomUse } from '../building/room-use'
import type { SceneMaterial } from '../schema'
import { type RoomReading, readRooms } from './room-readings'
import { WET_TILED_TO_M } from './room-wet'
import type { SceneNodes } from './types'
import { registerSceneCheck } from './verify-scene'
import { type DefaultWallFace, readWallFaces, type WallFaceReading } from './wall-face-defaults'

/**
 * What the rooms of a scene owe, checked at the end of a turn: a wet room with no tile, rooms with no
 * skirting, a piece hung on the face of the wall that looks into another room than the one it names.
 * Like the coherence checks they guide and never forbid: each says what the scene shows and leaves
 * the maker to fix it or keep it. A finding fires only where the nodes can be read to the end (an
 * inline material, a script-built face or a scene ref with no scene materials is `unknown`, and
 * unknown fires nothing).
 */

export const ROOM_CHECK_CODES = [
  'room_wet_untiled',
  'rooms_no_skirting',
  'rooms_skirting_partial',
  'wall_faces_default',
  'rooms_floors_default',
  'room_no_floor',
] as const
export type RoomCheckCode = (typeof ROOM_CHECK_CODES)[number]

export type RoomCheckIssue = {
  type: RoomCheckCode
  message: string
  severity: 'warning'
  nodeIds: string[]
}

const WORDS_SHOWN = 6

/** Names as a sentence lists them: the first few, then how many more. */
const listed = (names: readonly string[]) =>
  names.length <= WORDS_SHOWN
    ? names.join(', ')
    : `${names.slice(0, WORDS_SHOWN).join(', ')} and ${names.length - WORDS_SHOWN} more`

const finishes = (room: RoomReading) =>
  `its floor is ${room.floor.finish} and its walls ${room.walls.finishes.join(', ') || 'unfinished'}`

const metres = (value: number) => `${value.toFixed(2)} m`

/**
 * A wet room (bathroom, shower room, WC, laundry) whose walls are not tiled as a wet room is: to
 * `WET_TILED_TO_M` on the walls its fixtures stand against, and to the ceiling around its shower. A
 * tiled floor does not make up for walls that splash.
 */
export function wetRoomIssues(rooms: readonly RoomReading[]): RoomCheckIssue[] {
  return rooms.flatMap((room): RoomCheckIssue[] => {
    const wet = room.wet
    if (wet?.verdict !== 'no' || !isWetRoomUse(room.use)) return []
    const where = wet.byFixtures ? 'the walls its fixtures stand against' : 'its walls'
    const bareShower = wet.showers.find((shower) => shower.full === 'no')
    const [lead, fix] =
      wet.tiled === 'no'
        ? [
            !wet.anyTile
              ? `shows no tile on ${where}`
              : wet.tiledTo && wet.tiledTo > 0.05
                ? `has tile up to ${metres(wet.tiledTo)} on ${where}`
                : `has tile on part of ${where}, along less than most of their length`,
            `tile ${where} to ${metres(WET_TILED_TO_M)}`,
          ]
        : [
            `is tiled to ${metres(WET_TILED_TO_M)} but not to the ceiling around its shower (${bareShower?.name})`,
            `tile the walls around ${bareShower?.name} to the ceiling`,
          ]
    return [
      {
        type: 'room_wet_untiled',
        message: `${room.name} (${room.use}, ${room.levelName}) ${lead}: ${finishes(room)}. A wet room is usually tiled to ${metres(WET_TILED_TO_M)} on the walls its fixtures stand against and to the ceiling around its shower, whatever its floor; ${fix}, or keep the finish if it is intended.`,
        severity: 'warning',
        nodeIds: [room.id],
      },
    ]
  })
}

/**
 * Fewer rooms than this are a room or two, not a house: bare wall bases there say nothing of a
 * finishing recipe, and a scene of one room is mostly a test or a demonstration.
 */
const HOUSE_MIN_ROOMS = 3

/**
 * Skirting, from the faces of a room's walls: the rooms a finished floor meets in view (bedrooms,
 * living and dining rooms, offices, hallways) that have none on any face. When some rooms have it
 * the finding names the ones left bare; when none has it, it is about the scene, and only for a
 * house of at least `HOUSE_MIN_ROOMS` such rooms. Rooms with no known wall face are not read.
 */
export function skirtingIssue(rooms: readonly RoomReading[]): RoomCheckIssue | null {
  const bare = rooms.filter(
    (room) => isSkirtedRoomUse(room.use) && room.skirting.faces > 0 && !room.skirting.withSkirting,
  )
  if (!bare.length) return null
  const skirted = rooms.filter((room) => room.skirting.withSkirting > 0)
  const nodeIds = bare.map((room) => room.id)
  if (!skirted.length)
    return bare.length < HOUSE_MIN_ROOMS
      ? null
      : {
          type: 'rooms_no_skirting',
          message: `No room of the scene has skirting: ${listed(bare.map((room) => room.name))} (${bare.length}) show bare wall bases. Skirting is the skirting field of the wall: set it on the walls of these rooms, or keep the bare bases if they are intended.`,
          severity: 'warning',
          nodeIds,
        }
  return {
    type: 'rooms_no_skirting',
    message: `${listed(bare.map((room) => room.name))} have no skirting while ${listed(skirted.map((room) => room.name))} do. Skirting is the skirting field of the wall: set it on the walls of these rooms, or keep them bare if that is intended.`,
    severity: 'warning',
    nodeIds,
  }
}

/**
 * Skirting on part of a room's faces: a room the skirting is owed in (see `skirtingIssue`) that has it
 * on some of the wall faces looking in and not on the others. A room with none is `skirtingIssue`'s.
 */
export function partialSkirtingIssue(rooms: readonly RoomReading[]): RoomCheckIssue | null {
  const partial = rooms.filter(
    (room) =>
      isSkirtedRoomUse(room.use) &&
      room.skirting.withSkirting > 0 &&
      room.skirting.withSkirting < room.skirting.faces,
  )
  if (!partial.length) return null
  return {
    type: 'rooms_skirting_partial',
    message: `Skirting is on part of the wall faces of ${listed(
      partial.map(
        (room) => `${room.name} (${room.skirting.withSkirting} of ${room.skirting.faces} faces)`,
      ),
    )}: ${plural(partial.length, 'room')} of the ${plural(rooms.filter((room) => isSkirtedRoomUse(room.use)).length, 'room')} that owe it.`,
    severity: 'warning',
    nodeIds: partial.map((room) => room.id),
  }
}

/** Rooms with no floor under them: no plate of their own, no drawn slab they were taken from, and slabs over less than half their footprint. */
export function noFloorIssue(rooms: readonly RoomReading[]): RoomCheckIssue | null {
  const bare = rooms.filter((room) => room.indoor && !room.floor.held)
  if (!bare.length) return null
  return {
    type: 'room_no_floor',
    message: `No floor plate or slab is under ${listed(bare.map((room) => `${room.name} (${room.levelName})`))}: slabs cover less than half of ${bare.length === 1 ? 'its footprint' : 'each footprint'}.`,
    severity: 'warning',
    nodeIds: bare.map((room) => room.id),
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * The floors of the indoor rooms that show the default, as one finding that names the rooms and
 * says how many other rooms show a finish. Fewer than `HOUSE_MIN_ROOMS` rooms all at the default
 * are a test or a demonstration and say nothing. A ceiling at its default is normal and is not
 * read; the wall faces are read apart (`wallFaceDefaultIssue`): by wall, not through a room.
 */
export function floorDefaultIssue(rooms: readonly RoomReading[]): RoomCheckIssue | null {
  const indoor = rooms.filter((room) => room.indoor)
  const bare = indoor.filter((room) => room.floor.atDefault)
  if (!bare.length || (bare.length === indoor.length && indoor.length < HOUSE_MIN_ROOMS))
    return null
  return {
    type: 'rooms_floors_default',
    message: `Floors at the default, no finish written for them: ${listed(bare.map((room) => room.name))}${
      bare.length === indoor.length
        ? ` (all ${plural(indoor.length, 'room')} read)`
        : `; the other ${plural(indoor.length - bare.length, 'room')} read show a finish`
    }.`,
    severity: 'warning',
    nodeIds: bare.map((room) => room.id),
  }
}

const two = (value: number) => value.toFixed(2)
const spot = (point: readonly [number, number]) => `${point[0]}, ${point[1]}`

/** Where a default face is, as the finding says it: the rooms it faces, or the room its wall stands in. */
const placeOf = (face: DefaultWallFace) =>
  face.facing.length
    ? `facing ${listed(face.facing)}`
    : face.standsIn.length
      ? `inside ${listed(face.standsIn)}`
      : 'with no room on that side'

/** One wall's default faces as a clause: both faces together when they are alike, else each face. */
function wallClause(faces: readonly DefaultWallFace[]): string {
  const [one] = faces
  const alike =
    faces.length === 2 &&
    Math.abs(faces[0]!.metres - faces[1]!.metres) < 0.01 &&
    placeOf(faces[0]!) === placeOf(faces[1]!)
  const how = alike
    ? `both faces ${two(faces[0]!.metres)} m ${placeOf(faces[0]!)}`
    : faces.map((face) => `face ${face.face} ${two(face.metres)} m ${placeOf(face)}`).join(', ')
  const first = faces.reduce((a, b) => (b.stretches[0]![0] < a.stretches[0]![0] ? b : a))
  const last = faces.reduce((a, b) => (b.stretches.at(-1)![1] > a.stretches.at(-1)![1] ? b : a))
  return `“${one!.wallName}” (${one!.levelName}): ${how}, from ${spot(first.from)} to ${spot(last.to)}`
}

/**
 * The wall faces nobody gave a finish, read from the walls themselves (`readWallFaces`): one finding
 * that names each wall with its default faces, how long they are, where they run in plan and which
 * room they face (or stand inside), and how many of the faces read show the default. The walls of a
 * scene of fewer than `HOUSE_MIN_ROOMS` rooms whose faces are all at the default are a test or a
 * demonstration and say nothing.
 */
export function wallFaceDefaultIssue(
  read: WallFaceReading,
  roomsRead: number,
): RoomCheckIssue | null {
  if (!read.defaults.length) return null
  const bare = new Set(read.defaults.map((face) => `${face.wallId}/${face.face}`)).size
  if (bare >= read.faces && roomsRead < HOUSE_MIN_ROOMS) return null
  const byWall = new Map<string, DefaultWallFace[]>()
  for (const face of read.defaults)
    byWall.set(face.wallId, [...(byWall.get(face.wallId) ?? []), face])
  const metres = read.defaults.reduce((sum, face) => sum + face.metres, 0)
  const total = (faces: readonly DefaultWallFace[]) =>
    Math.round(faces.reduce((sum, face) => sum + face.metres, 0) * 100)
  const longest = [...byWall.values()].sort((p, q) => total(q) - total(p))
  return {
    type: 'wall_faces_default',
    message: `Wall faces at the default, no finish written for them: ${listed(longest.map(wallClause))}; ${bare} of ${plural(read.faces, 'wall face')} read (${metres.toFixed(1)} of ${read.metres.toFixed(1)} m) show the default.`,
    severity: 'warning',
    nodeIds: [...byWall.keys()],
  }
}

/** Every room check on a scene. */
export function roomCheckIssues(
  nodes: SceneNodes,
  options: { materials?: Readonly<Record<string, SceneMaterial>> } = {},
): RoomCheckIssue[] {
  const rooms = readRooms(nodes, { materials: options.materials })
  const wallFaces = wallFaceDefaultIssue(
    readWallFaces(nodes),
    rooms.filter((room) => room.indoor).length,
  )
  if (!rooms.length) return wallFaces ? [wallFaces] : []
  const skirting = skirtingIssue(rooms)
  const partial = partialSkirtingIssue(rooms)
  const noFloor = noFloorIssue(rooms)
  const floors = floorDefaultIssue(rooms)
  return [
    ...wetRoomIssues(rooms),
    ...(skirting ? [skirting] : []),
    ...(partial ? [partial] : []),
    ...(noFloor ? [noFloor] : []),
    ...(wallFaces ? [wallFaces] : []),
    ...(floors ? [floors] : []),
  ]
}

registerSceneCheck({
  name: 'room checks',
  order: 70,
  run: (nodes, _input, context) => {
    try {
      return roomCheckIssues(nodes as SceneNodes, { materials: context?.materials })
    } catch {
      // A scene the readers cannot walk (a wall stored without its start) is the schema check's to
      // report, not a reason for verify_scene to fail.
      return []
    }
  },
})
