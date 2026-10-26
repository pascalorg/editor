// What a conversion delivered, measured from what was written: the payload, `author_scene`'s
// report and the scene's own checks, never a model's judgement. Generic: nothing here knows a
// house. An agent iterating on its conversion reads them as its to-do list.
import type { AuthorScenePayload } from '../agent-tools/author-scene'
import type { AuthorSceneDefect } from './author-scene'

export type AuthorSceneCheck = {
  id:
    | 'openings'
    | 'glass'
    | 'floors'
    | 'pieces'
    | 'outside'
    | 'faces'
    | 'stairs'
    | 'levels'
    | 'refused'
  passed: boolean
  /** What was measured, in a sentence or a few. */
  detail: string
}

type Finding = AuthorSceneDefect

/** An item of the payload waiting for its piece (an add_object piece still being made). */
export type AuthorScenePending = { id: string; piece: string }

const OPEN_CLIP =
  /AnimationClip\(\s*['"`]open['"`]\s*,[^)]*\[\s*[^\]\s]|"name":"open","duration":[^,]+,"tracks":\[\{/
const GLASS = /\.name\s*=\s*['"`]glass['"`]|name\s*:\s*['"`]glass['"`]|"name":"glass"/
/**
 * Items sharing one module, or one name but for its numbers, past this many are one thing written
 * piece by piece (a lawn's tufts); a row of shrubs or a set of chairs stays under it.
 */
const SAME_MAX = 24
/** A slab whose top is this far under its level's floor is buried. */
const BURIED_M = 0.2
const FACE_CODES = new Set(['face_script_failed', 'no_face', 'face_shared'])
const PIECE_CODES = new Set(['piece_failed', 'piece_unknown', 'pieces_unavailable'])

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listed = (findings: readonly Finding[]) =>
  findings.map((f) => `${f.id} (${f.code}: ${f.message.slice(0, 160)})`).join('; ')

type Opening = { kind?: string; type?: string; code?: string; name?: string }
type Item = { id: string; name?: string; code?: string; piece?: string }

/** Moves: its own module carries an `open` clip, or Pascal's type for it opens. */
const moves = (o: Opening) =>
  o.code
    ? OPEN_CLIP.test(o.code)
    : o.kind === 'door' || (o.type !== undefined && o.type !== 'fixed')

/**
 * The checks of a conversion as written: openings a person operates move, glazing is glass, every
 * room's floor finish covers it and follows its polygon, every piece named stands, what stands
 * outside is whole and above ground, wall finishes are built, stairs arrive inside a room clear of
 * walls, every level holds rooms or walls, and nothing else was refused. `payload` is what was
 * written (items naming a piece carry it, written with its module or pending).
 */
export function authorSceneChecks(args: {
  payload: AuthorScenePayload
  report: {
    defects: readonly Finding[]
    warnings: readonly Finding[]
    ids: Readonly<Record<string, string>>
  }
  pending: readonly AuthorScenePending[]
  /** The scene check's findings after the write (`verify_scene`), by type. */
  issues: ReadonlyArray<{ type?: string; message?: string }>
}): AuthorSceneCheck[] {
  const { payload, report } = args
  const defects = report.defects
  const warnings = report.warnings
  const counted = new Set<Finding>()
  const take = (findings: readonly Finding[]) => {
    for (const f of findings) counted.add(f)
    return findings
  }

  const openings = payload.levels.flatMap((level) =>
    (level.walls ?? []).flatMap((wall) =>
      (wall.openings ?? []).map((o, i) => ({ ...(o as Opening), id: `${wall.id}/${i}` })),
    ),
  )
  const operated = openings.filter((o) => o.kind === 'door' || o.kind === 'window')
  const openingDefects = take(defects.filter((d) => operated.some((o) => o.id === d.id)))
  // Fixed glazing (a sidelight, a picture window) opens by no one.
  const fixed = operated.filter((o) => o.kind === 'window' && o.type === 'fixed')
  const still = operated.filter(
    (o) => !(fixed.includes(o) || (moves(o) && !openingDefects.some((d) => d.id === o.id))),
  )
  const windows = operated.filter((o) => o.kind === 'window')
  const opaque = windows.filter((o) => o.code && !GLASS.test(o.code))

  const gaps = warnings.filter((w) => w.code === 'finish_gaps' && w.id.startsWith('room/'))
  const roomDefects = take(defects.filter((d) => d.id.startsWith('room/')))
  const rooms = payload.levels.flatMap((level, l) =>
    level.rooms.map((room, i) => ({ ...room, id: `room/${l}/${i}` })),
  )
  // A seed that named no room of its own and was not refused shares another's enclosure; when it
  // brought its own floor, that floor is not laid.
  const merged = Object.keys(report.ids).length
    ? rooms.filter((r) => !(report.ids[r.id] || roomDefects.some((d) => d.id === r.id)))
    : []
  const lostFloors = merged.filter((r) => r.floor || r.floorCode || r.floorRegions?.length)
  const frozenFloors = rooms.filter((r) => r.floorCode && !/params\.polygon/.test(r.floorCode))

  const allItems: Item[] = [
    ...payload.levels.flatMap((level) => level.items ?? []),
    ...(payload.roof?.items ?? []),
  ]
  const named = allItems.filter((item) => item.piece !== undefined)
  const pieceDefects = take(
    defects.filter((d) => PIECE_CODES.has(d.code) || named.some((item) => item.id === d.id)),
  )
  const items = allItems.filter((item) => item.piece === undefined && item.code)
  const debris = [
    (item: Item) => item.code,
    (item: Item) => item.name?.replace(/[\d.,-]+/g, '#'),
  ].flatMap((keyOf) => {
    const groups = new Map<string, Item[]>()
    for (const item of items) {
      const key = keyOf(item)
      if (key) groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.values()].filter((same) => same.length > SAME_MAX)
  })
  const buried = payload.levels.flatMap((level, l) =>
    (level.slabs ?? [])
      .filter((s) => (s.top ?? 0) < -BURIED_M)
      .map((s) => `${s.name ?? 'a slab'} (level ${l}, top ${s.top} m)`),
  )
  const objectDefects = take(
    defects.filter((d) => d.id.startsWith('slab/') || items.some((item) => item.id === d.id)),
  )

  const faceDefects = take(defects.filter((d) => FACE_CODES.has(d.code)))
  const faceGaps = warnings.filter((w) => w.code === 'finish_gaps' && !w.id.startsWith('room/'))

  const stairDefects = take(defects.filter((d) => d.id.startsWith('stair/')))
  const stairIssues = args.issues.filter((issue) => issue.type?.startsWith('stair_'))

  const empty = payload.levels.filter((level) => !level.walls?.length && !level.rooms.length)

  const rest = defects.filter((d) => !counted.has(d))
  const placed = named.length - args.pending.length - pieceDefects.length

  return [
    {
      id: 'openings',
      passed: still.length === 0,
      detail: `${operated.length - still.length - fixed.length} of ${plural(operated.length - fixed.length, 'door or window', 'doors and windows')} a person operates move${fixed.length ? ` (${plural(fixed.length, 'window')} written fixed)` : ''}${still.length ? `; these do not: ${still.map((o) => `${o.id} ${o.name ?? o.kind} (${openingDefects.find((d) => d.id === o.id)?.message.slice(0, 160) ?? (o.code ? 'its module has no open clip' : 'no type: written fixed')})`).join(', ')}` : ''}.`,
    },
    {
      id: 'glass',
      passed: opaque.length === 0,
      detail: opaque.length
        ? `${plural(opaque.length, 'window module')} with no material named glass: ${opaque.map((o) => o.id).join(', ')}.`
        : `Every window's glazing is glass (${plural(windows.length, 'window')}).`,
    },
    {
      id: 'floors',
      passed:
        gaps.length === 0 &&
        roomDefects.length === 0 &&
        lostFloors.length === 0 &&
        frozenFloors.length === 0,
      detail:
        [
          ...gaps.map((w) => w.message),
          ...roomDefects.map((d) => `${d.id}: ${d.message}`),
          ...lostFloors.map(
            (r) =>
              `"${r.name}" has no walls of its own: it joined another room, whose floor is laid instead of its own.`,
          ),
          ...frozenFloors.map(
            (r) =>
              `"${r.name}"'s floor module does not read params.polygon: a resized room is not covered.`,
          ),
        ].join(' ') || `Every room's floor finish covers it (${plural(rooms.length, 'room')}).`,
    },
    {
      id: 'pieces',
      passed: pieceDefects.length === 0,
      detail: `${placed} of the ${plural(named.length, 'item')} naming a piece stand${args.pending.length ? `; ${args.pending.length} wait for their piece and are written when it lands` : ''}${pieceDefects.length ? `; not written: ${listed(pieceDefects)}` : ''}.`,
    },
    {
      id: 'outside',
      passed: debris.length === 0 && buried.length === 0 && objectDefects.length === 0,
      detail:
        [
          ...debris.map(
            (same) =>
              `${same.length} items are one thing ("${same[0]!.name ?? same[0]!.id}"), written one by one: write them as one object.`,
          ),
          ...buried.map((slab) => `${slab} is buried under the floor.`),
          ...(objectDefects.length
            ? [
                `Pascal refused ${plural(objectDefects.length, 'object')}: ${listed(objectDefects)}.`,
              ]
            : []),
        ].join(' ') || 'Every object and slab is written, none buried or written as loose debris.',
    },
    {
      id: 'faces',
      passed: faceDefects.length === 0 && faceGaps.length === 0,
      detail:
        [
          ...(faceDefects.length
            ? [
                `${plural(faceDefects.length, 'wall finish', 'wall finishes')} not built: ${listed(faceDefects)}.`,
              ]
            : []),
          ...faceGaps.map((w) => w.message),
        ].join(' ') || 'Every wall finish is built and covers its face.',
    },
    {
      id: 'stairs',
      passed: stairDefects.length === 0 && stairIssues.length === 0,
      detail:
        [
          ...(stairDefects.length ? [`Refused: ${listed(stairDefects)}.`] : []),
          ...stairIssues.map((issue) => issue.message ?? issue.type),
        ].join(' ') || 'Every stair arrives inside a room, clear of walls.',
    },
    {
      id: 'levels',
      passed: empty.length === 0,
      detail: empty.length
        ? `${empty.map((level) => `"${level.name}"`).join(', ')} ${empty.length === 1 ? 'holds' : 'hold'} no rooms or walls: a level is a storey. The ground, terraces, paths and foundations belong to the ground level (Pascal draws the site and the foundations); move what stands there onto it.`
        : `Every level holds rooms or walls (${plural(payload.levels.length, 'level')}).`,
    },
    {
      id: 'refused',
      passed: rest.length === 0,
      detail: rest.length
        ? `Pascal refused ${plural(rest.length, 'other part')}: ${listed(rest)}.`
        : 'Nothing else was refused.',
    },
  ]
}
