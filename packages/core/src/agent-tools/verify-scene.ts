import { z } from 'zod'
import {
  findingsOfRoom,
  foldUsageRooms,
  isRoomFolded,
  isUsageType,
  PASSAGE_TYPE,
  passageEntrances,
  ROOM_ENTRY_TYPE,
  roomsWithUsageFindings,
  servedRoomIds,
  slimUsageFinding,
  usageNote,
} from './verify-scene-usage'

/**
 * `verify_scene`'s contract. Other modules extend it with an input and a sentence for the check
 * they register (the photo's: `photo`), so it stays one tool agents know, with one contract on
 * both surfaces, and imports none of them.
 */
const extensions: { input: Record<string, z.ZodType>; description: string }[] = []

/** Adds inputs and a sentence of description to verify_scene, for a check registered with it. */
export function extendVerifyScene(extension: {
  input: Record<string, z.ZodType>
  description: string
}) {
  extensions.push(extension)
}

const DESCRIPTION =
  'Optional whole-scene evidence: per-level content, roles (storey, roof-only, support) and the spaces its walls enclose, then every problem found, each with a type: empty levels, walls with no room or door, a space the walls enclose with no room over it (space_no_room) or with several and no wall between them (space_many_rooms), a room the walls do not close (room_not_enclosed) or with no name (room_unnamed), two rooms on the same clear floor (zones_overlap) and floor inside a covered space that no zone or stair claims (floor_unclaimed), both warnings with their area, width and place and quiet under 0.1 m² (overlap), 0.3 m² (unclaimed) or 15 cm wide, wall bodies not counting as floor, an end that stops 3-25 cm short of another wall (wall_end_short, warning: the daylight in cm, both walls named; an end that touches a wall is a joint) and a wall 0.5-6 degrees off the line of the walls it carries on from or sits between, when that moves its far end 2 cm or more off the line (wall_nearly_aligned, warning: the angle, the offset, the neighbours; a larger turn is an angle drawn on purpose and is not named), rooms with no floor or ceiling, storeys with no stair, roof levels misused, walls intersecting a covering slab or ending coplanar with its walking surface (wall_covering_slab_contact, with wallId and slabId), openings off their wall, stairs off their slab or blocked, furniture blocking a door or overlapping, a house past its lot line or in its required yards, every node field its schema rejects (schema_invalid, with its nodeId and path; valid is then false, and the level holding the node lists it as unread and is measured once it is fixed), a node kind no schema here knows, once per kind (schema_unknown_kind, info: a plugin kind), a hidden site (site_hidden). What the surfaces of a room say, each one an observation to keep when it is intended: a wet room whose walls are not tiled where its fixtures stand (room_wet_untiled), skirting in no room or on part of the wall faces of a room (rooms_no_skirting, rooms_skirting_partial), and floors and wall faces left at the default finish (rooms_floors_default, wall_faces_default). Static authored ceiling objects report transformed bounds extending above their ceiling attachment and bounds overlapping solid covering slab bands, with node IDs and measured metres; stored and derived slab holes are subtracted. Wall-mounted objects report a front oriented toward their host; static authored wall bounds report wall-body overlap and extension through the opposite face. With settled editor meshes, catalog wall bounds and large competing coplanar faces against the host or another item on the same wall are also measured within 1 mm. Hidden back-to-wall contact is not competing face evidence. These are observations, not instructions to change the scene or proof of exact mesh intersection. Bounds are measured in the owning building frame, including stacked level elevations. Unknown catalog raw bounds without meshes, animated models, unsupported attachment frames, unresolved scripted wall cuts, roof collisions, recessed slab shells and foundation volumes are not assessed.'

export const verifySceneTool = {
  name: 'verify_scene',
  title: 'Verify scene',
  get description() {
    return [
      DESCRIPTION,
      'Every warning and every error arrives whole, its own measurements with it; a repeated informational finding (severity info) arrives once, with its count, its elements and a few examples.',
      "Usage findings arrive trimmed, a narrow passage as one entry for the place with the rooms it leads to, each room's turning circle and pocket as one usage_room entry; `room` (a room's id or name) returns its whole findings plus every finding naming its items, doors or windows, even when placed in a neighbouring room; `type` returns the whole findings of that kind.",
      ...extensions.map((extension) => extension.description),
    ].join(' ')
  },
  get input(): Record<string, z.ZodType> {
    return Object.assign(
      {
        type: z
          .string()
          .min(1)
          .optional()
          .describe(
            'One finding type (for example "usage_passage_narrow"): the answer then lists every original finding of that type, whole, and none of the other blocks of the report.',
          ),
        room: z
          .string()
          .min(1)
          .optional()
          .describe(
            "A room's id or name: the answer lists its findings whole, including passages serving it and every finding naming its items, doors or windows.",
          ),
      },
      ...extensions.map((extension) => extension.input),
    )
  },
}

const groupedReport = z.object({
  issues: z.array(z.unknown()),
  issueGroups: z.array(
    z.looseObject({
      type: z.string(),
      message: z.string(),
      count: z.number().int().positive(),
      issueIndexes: z.array(z.number().int().nonnegative()).min(1),
      // Read for the presentation alone: a group's other fields (its moves) ride along untouched.
      severity: z.enum(['info', 'warning']).optional(),
      nodes: z.unknown().optional(),
    }),
  ),
})

/** A type's findings, as `sceneIssueGroups` gathered them. */
type SceneIssueGroup = z.infer<typeof groupedReport>['issueGroups'][number]

/** Complete examples of one repeated informational finding that ride with its group. */
const GROUP_EXAMPLES = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** `verify_scene`'s arguments, read for the presentation; the operation itself receives them all. */
function requestedType(input: unknown): string | null {
  const type = isRecord(input) ? input.type : null
  return typeof type === 'string' && type.length > 0 ? type : null
}

function requestedRoom(input: unknown): string | null {
  const room = isRecord(input) ? input.room : null
  return typeof room === 'string' && room.trim().length > 0 ? room : null
}

/**
 * What the model reads for `verify_scene`: the same facts, grouped. Every warning and error is
 * whole — its message, its node ids and its measurements — a repeated informational finding is one
 * entry per type with a few examples and the call that returns them all, The usage findings are the exception that
 * keeps every finding: a narrow passage is one entry for its place, a room's turning circle and
 * pocket are one entry for the room, the others arrive one by one without the structure their sentence repeats (`verify-scene-usage.ts`).
 * A `type` or `room` question and a refusal answer as they came; no other argument widens the
 * answer. The editor, the structured MCP result and the benchmarks keep the report `verify_scene`
 * returned.
 */
export function verifySceneModelResult(output: unknown, input: unknown): unknown {
  const parsed = groupedReport.safeParse(output)
  if (!parsed.success) return output
  const { issues, issueGroups } = parsed.data
  if (issueGroups.some((group) => group.issueIndexes.some((index) => index >= issues.length)))
    return output
  const report = output as Record<string, unknown>
  const type = requestedType(input)
  const room = requestedRoom(input)
  if (type) return oneTypeReport(report, issues, issueGroups, type, room)
  if (room) return oneRoomReport(report, issues, room)
  return compactReport(report, issues, issueGroups)
}

/**
 * `type: "…"`: every original finding of that one type, and none of the report's other blocks.
 * `usage_room`, the type of a room's entry, gives the findings the entries hold; with a `room`, only that room's.
 */
function oneTypeReport(
  report: Record<string, unknown>,
  issues: unknown[],
  issueGroups: SceneIssueGroup[],
  type: string,
  room: string | null,
): unknown {
  const ofType = issues.filter(
    (issue) =>
      isRecord(issue) &&
      (type === ROOM_ENTRY_TYPE ? isRoomFolded(issue.type) : issue.type === type),
  )
  const findings = room ? findingsOfRoom(ofType, room, report.roomScope) : ofType
  const named = { ok: report.ok, type, ...(room ? { room } : {}) }
  if (findings.length > 0) return { ...named, issueCount: findings.length, issues: findings }
  return {
    ...named,
    issueCount: 0,
    issues: [],
    types: Object.fromEntries(issueGroups.map((group) => [group.type, group.count])),
  }
}

/** `room: "…"`: the room's findings and those naming its contents, whole. */
function oneRoomReport(report: Record<string, unknown>, issues: unknown[], room: string): unknown {
  const findings = findingsOfRoom(issues, room, report.roomScope)
  if (findings.length > 0)
    return { ok: report.ok, room, issueCount: findings.length, issues: findings }
  return {
    ok: report.ok,
    room,
    issueCount: 0,
    issues: [],
    rooms: roomsWithUsageFindings(issues),
  }
}

function compactReport(
  report: Record<string, unknown>,
  issues: unknown[],
  issueGroups: SceneIssueGroup[],
): unknown {
  const { issueGroups: _groups, ...rest } = report
  const { shown, measuredFrom } = shownIssues(issues, issueGroups)
  return {
    ...rest,
    issueCount: issues.length,
    issues: shown,
    ...(shown.some((issue) => isRecord(issue) && isUsageType(issue.type))
      ? { usageNote: usageNote(measuredFrom) }
      : {}),
  }
}

/** Every warning and error whole; one entry for each repeated informational finding; the usage findings as the room entries and the singles they are. */
function shownIssues(
  issues: unknown[],
  issueGroups: SceneIssueGroup[],
): { shown: unknown[]; measuredFrom: string[] } {
  const shown: unknown[] = []
  const grouped = new Set<number>()
  const roomFindings: Record<string, unknown>[] = []
  let roomsAt = -1
  const passages = issues.filter(isRecord).filter((issue) => issue.type === PASSAGE_TYPE)
  const entrances = passageEntrances(passages)
  for (const group of issueGroups) {
    const members = group.issueIndexes.map((index) => {
      grouped.add(index)
      return issues[index]
    })
    // A room's turning circle and pocket are one entry for the room, where the first of them stood.
    if (isRoomFolded(group.type)) {
      if (roomsAt < 0) roomsAt = shown.length
      roomFindings.push(...members.filter(isRecord))
      continue
    }
    // The other usage findings arrive one by one, info or not, without the structure their message repeats.
    if (isUsageType(group.type)) {
      shown.push(
        ...members.map((member) =>
          isRecord(member) ? slimUsageFinding(member, entrances) : member,
        ),
      )
      continue
    }
    // A lone finding of a type is its own complete example, informational or not.
    if (group.severity === 'info' && members.length > 1) {
      shown.push(infoGroup(group, members))
      continue
    }
    shown.push(...members)
  }
  if (roomsAt >= 0) {
    const entries = foldUsageRooms(roomFindings, servedRoomIds(passages))
    shown.splice(
      roomsAt,
      0,
      ...entries.filter((entry) => entry.severity !== 'info'),
      ...entries.filter((entry) => entry.severity === 'info'),
    )
  }
  // A finding no group gathered still arrives whole: the presentation hides none.
  issues.forEach((issue, index) => {
    if (!grouped.has(index)) shown.push(issue)
  })
  return { shown, measuredFrom: entrances.length === 1 ? entrances : [] }
}

/** A repeated informational finding: how many, where, a few examples, and how to read them all. */
function infoGroup(group: SceneIssueGroup, members: unknown[]) {
  const { issueIndexes: _indexes, nodes: _nodes, ...summary } = group
  return {
    ...summary,
    examples: distinctExamples(members),
    detail: `verify_scene({ "type": "${group.type}" }) returns all ${members.length} findings`,
  }
}

/** The first few findings that differ, so a group of identical records costs one of them. */
function distinctExamples(members: unknown[]): unknown[] {
  const examples: unknown[] = []
  const seen = new Set<string>()
  for (const member of members) {
    const key = JSON.stringify(member)
    if (seen.has(key)) continue
    seen.add(key)
    examples.push(member)
    if (examples.length === GROUP_EXAMPLES) break
  }
  return examples
}
