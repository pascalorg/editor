import { describe, expect, test } from 'bun:test'
import { sceneIssueGroups } from '../agent-operations/scene-issue-groups'
import type { SceneNodes } from '../agent-operations/types'
import { BED_ACCESS_M } from '../spatial/usage-field/beds'
import { WINDOW_ABOVE_SILL_M, WINDOW_BLOCK_M } from '../spatial/usage-field/blocked'
import { CLASH_WARNING_M } from '../spatial/usage-field/clash'
import { DOOR_M, PASSAGE_M, TURNING_M } from '../spatial/usage-field/findings'
import { OPENS_FULLY_DEG } from '../spatial/usage-field/swings'
import { verifySceneModelResult } from './index'

// The usage findings a model reads: a room's turning circle and pocket as one entry for the room; a
// narrow place as one entry naming the rooms it leads to; every other finding one by one, without
// the structure its message and node ids repeat; the words every entry would say once; and the whole
// findings back by room or by kind. The report keeps each finding as measured.

type Found = Record<string, unknown> & { type: string }

const place = (room: string, roomId: string, at: [number, number] = [1.234, 5.678]) => ({
  room,
  roomId,
  at,
})
const obstacle = (nodeId: string, name: string) => ({
  nodeId,
  name,
  kind: 'item',
  shape: 'exact',
  movable: false,
})

/** A narrow place as `usageIssues` makes it: one finding for the rooms the way through it leads to. */
const passage = (rooms: [room: string, roomId: string][], over: Partial<Found> = {}): Found => {
  const sentence = `${rooms.map(([room]) => `“${room}”`).join(' and ')}: 0.62 m clear between the jambs of “Door 4”, a 0.72 m door`
  const tail = ' (below 0.80 m, a doorway).'
  return {
    type: 'usage_passage_narrow',
    message: `Narrow passage to ${sentence}, measured from “Front door”${tail}`,
    brief: `Passage to ${sentence}${tail}`,
    fromDoor: 'Front door',
    severity: 'warning',
    nodeIds: [...rooms.map(([, roomId]) => roomId), 'door_4'],
    valueM: 0.62,
    thresholdM: 0.8,
    doorWidthM: 0.72,
    place: place(rooms[0]![0], rooms[0]![1]),
    obstacles: [obstacle('door_4', 'Door 4')],
    serves: rooms.map(([room, roomId]) => ({ room, roomId })),
    approximate: false,
    ...over,
  }
}
const turning = (room: string, roomId: string, over: Partial<Found> = {}): Found => ({
  type: 'usage_turning_narrow',
  message: `No 1.50 m turning circle in “${room}”: largest 1.20 m.`,
  brief: 'no 1.50 m turning circle, largest 1.20 m',
  severity: 'info',
  nodeIds: [roomId],
  valueM: 1.2,
  thresholdM: 1.5,
  place: place(room, roomId),
  obstacles: [],
  approximate: false,
  ...over,
})
const pocket = (room: string, roomId: string, over: Partial<Found> = {}): Found => ({
  type: 'usage_pocket',
  message: `“${room}”: 0.57 m² of floor with no 0.60 m way out, beside “Tub”.`,
  brief: '0.57 m² of floor with no 0.60 m way out, beside “Tub”',
  severity: 'warning',
  nodeIds: [roomId, 'item_tub'],
  valueM2: 0.57,
  place: place(room, roomId),
  obstacles: [obstacle('item_tub', 'Tub')],
  approximate: false,
  ...over,
})
const clash = (index: number, severity: 'warning' | 'info'): Found => ({
  type: 'usage_clash',
  message: `“Piece ${index}” stands 5 cm into the sill of “Window 2” in “Bath”.`,
  severity,
  nodeIds: ['zone_bath', `item_${index}`, 'window_2'],
  valueM: 0.048,
  thresholdM: 0.08,
  place: place('Bath', 'zone_bath', [-4.7712, -2.1234]),
  obstacles: [obstacle(`item_${index}`, `Piece ${index}`)],
  approximate: severity === 'info',
  code: { profile: 'irc-2021', cite: 'x', source: 'code text', byDefault: true },
})

/** A report as `verify_scene` returns it: the findings, and the groups the operation gathers them into. */
function reportOf(found: Found[]) {
  const issues = [...found]
  const issueGroups = sceneIssueGroups(issues as never, {} as SceneNodes)
  return { ok: true, issues, issueGroups, issueCount: issues.length, coherence: { open: 0 } }
}

const shownOf = (found: Found[], input: unknown = {}) =>
  verifySceneModelResult(reportOf(found), input) as {
    issues: Found[]
    usageNote?: string
    issueCount: number
  }

describe('a room’s turning circle and pocket are one entry', () => {
  test('together; the worst severity, every node, how many', () => {
    const { issues } = shownOf([turning('Bath', 'zone_bath'), pocket('Bath', 'zone_bath')])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toEqual({
      type: 'usage_room',
      severity: 'warning',
      message:
        'Bath: 0.57 m² of floor with no 0.60 m way out, beside “Tub”; no 1.50 m turning circle, largest 1.20 m.',
      nodeIds: ['zone_bath', 'item_tub'],
      count: 2,
    })
  })

  test('one entry for each room that has any, warnings first, where the first of them stood', () => {
    const blocker = {
      type: 'room_unreachable',
      message: 'A room no walk reaches',
      nodeIds: ['level_1'],
    }
    const { issues } = shownOf([
      turning('Closet', 'zone_closet', { severity: 'info' }),
      pocket('Bath', 'zone_bath'),
      blocker as Found,
      turning('Bath', 'zone_bath'),
    ])
    expect(issues.map((issue) => issue.type)).toEqual([
      'room_unreachable',
      'usage_room',
      'usage_room',
    ])
    expect(issues.slice(1).map((issue) => [issue.severity, issue.count])).toEqual([
      ['warning', 2],
      ['info', 1],
    ])
  })

  test('a whole floor with no way out, in a room a narrow place leads to, is the passage’s news', () => {
    const whole = pocket('Alfresco', 'zone_alfresco', {
      wholeRoom: true,
      brief: 'no 0.60 m way out from the entrance (10.27 m²)',
    })
    const { issues } = shownOf([passage([['Alfresco', 'zone_alfresco']]), whole])
    // the place says it; the room has nothing else to say, so it has no entry of its own
    expect(issues.map((issue) => issue.type)).toEqual(['usage_passage_narrow'])
    // the finding is counted, and its record is there for the asking
    expect(shownOf([passage([['Alfresco', 'zone_alfresco']]), whole]).issueCount).toBe(2)
    const alone = shownOf([whole]).issues
    expect(alone[0]!.message).toBe('Alfresco: no 0.60 m way out from the entrance (10.27 m²).')
    // with something else to say, the room keeps its entry and still leaves the pocket to the place
    const more = shownOf([
      passage([['Alfresco', 'zone_alfresco']]),
      whole,
      turning('Alfresco', 'zone_alfresco'),
    ]).issues
    expect(more.find((issue) => issue.type === 'usage_room')!.message).toBe(
      'Alfresco: no 1.50 m turning circle, largest 1.20 m.',
    )
  })
})

describe('a narrow place is one entry for the rooms it leads to', () => {
  test('naming every room, with the door as drawn and the clear width, and no structure its message repeats', () => {
    const { issues } = shownOf([
      passage([
        ['Bath', 'zone_bath'],
        ['Hall', 'zone_hall'],
      ]),
    ])
    expect(issues).toEqual([
      {
        type: 'usage_passage_narrow',
        severity: 'warning',
        message:
          'Passage to “Bath” and “Hall”: 0.62 m clear between the jambs of “Door 4”, a 0.72 m door (below 0.80 m, a doorway).',
        nodeIds: ['door_4'],
      },
    ])
  })

  test('the entrance the passages were measured from is said once; with several, each says which', () => {
    const one = shownOf([passage([['Bath', 'zone_bath']]), passage([['Hall', 'zone_hall']])])
    expect(one.issues.every((issue) => !String(issue.message).includes('Front door'))).toBe(true)
    expect(one.usageNote).toContain('Ground-floor passages are measured from “Front door”.')
    const two = shownOf([
      passage([['Bath', 'zone_bath']]),
      passage([['Hall', 'zone_hall']], {
        fromDoor: 'Back door',
        message: 'Narrow passage to “Hall”: 0.62 m, measured from “Back door” (below 0.80 m).',
      }),
    ])
    expect(two.issues.map((issue) => issue.message)).toEqual([
      'Narrow passage to “Bath”: 0.62 m clear between the jambs of “Door 4”, a 0.72 m door, measured from “Front door” (below 0.80 m, a doorway).',
      'Narrow passage to “Hall”: 0.62 m, measured from “Back door” (below 0.80 m).',
    ])
    expect(two.usageNote).not.toContain('measured from')
  })
})

describe('every other usage finding arrives one by one', () => {
  test('approximation evidence stays on singles, passages and room entries; a turning circle alone informs', () => {
    const { issues } = shownOf(
      [
        clash(1, 'warning'),
        passage([['Hall', 'zone_hall']], { approximate: true }),
        turning('Bath', 'zone_bath', { approximate: true }),
      ].map((found) => ({ ...found, approximate: true })),
    )
    expect(issues).toHaveLength(3)
    for (const issue of issues) {
      expect(issue.severity).toBe(issue.type === 'usage_room' ? 'info' : 'warning')
      expect(issue.approximate).toBe(true)
    }
  })

  test('warning or info, never as a group of examples, without the structure its message repeats', () => {
    const { issues, issueCount } = shownOf([
      ...Array.from({ length: 6 }, (_, index) => clash(index, 'info')),
      clash(9, 'warning'),
    ])
    expect(issueCount).toBe(7)
    expect(issues).toHaveLength(7)
    expect(issues[0]).toEqual({
      type: 'usage_clash',
      severity: 'warning',
      message: '“Piece 9” stands 5 cm into the sill of “Window 2” in “Bath”.',
      nodeIds: ['zone_bath', 'item_9', 'window_2'],
      valueM: 0.048,
      at: [-4.77, -2.12],
    })
    for (const issue of issues) {
      expect(Object.keys(issue)).not.toContain('obstacles')
      expect(Object.keys(issue)).not.toContain('place')
      expect(Object.keys(issue)).not.toContain('code')
      expect(Object.keys(issue)).not.toContain('examples')
    }
  })
})

describe('the whole findings, by room or by kind', () => {
  const found = [
    passage([
      ['Bath', 'zone_bath'],
      ['Hall', 'zone_hall'],
    ]),
    turning('Bath', 'zone_bath'),
    turning('Closet', 'zone_closet'),
    clash(1, 'warning'),
  ]

  test('a room, by id or by name, gives every usage finding of it as measured, the places that lead to it too', () => {
    for (const room of ['zone_bath', 'bath', ' Bath ']) {
      const answer = verifySceneModelResult(reportOf(found), { room }) as {
        room: string
        issueCount: number
        issues: Found[]
        coherence?: unknown
      }
      expect(answer.issueCount).toBe(3)
      expect(answer.issues.map((issue) => issue.type).sort()).toEqual([
        'usage_clash',
        'usage_passage_narrow',
        'usage_turning_narrow',
      ])
      // whole: the obstacles, the places and the rooms it leads to stay
      expect(answer.issues.find((issue) => issue.type === 'usage_passage_narrow')).toEqual(
        passage([
          ['Bath', 'zone_bath'],
          ['Hall', 'zone_hall'],
        ]),
      )
      expect(answer.coherence).toBeUndefined()
    }
    // a room the place leads to has it, though the finding's own place names another
    const hall = verifySceneModelResult(reportOf(found), { room: 'Hall' }) as { issues: Found[] }
    expect(hall.issues.map((issue) => issue.type)).toEqual(['usage_passage_narrow'])
  })

  test('a room nothing was found in names the rooms there are', () => {
    const answer = verifySceneModelResult(reportOf(found), { room: 'Attic' }) as Record<
      string,
      unknown
    >
    expect(answer).toMatchObject({ room: 'Attic', issueCount: 0, issues: [] })
    expect(answer.rooms).toEqual(['Bath', 'Hall', 'Closet'])
  })

  test('the type of a room’s entry gives the findings the entries hold; a kind gives its own, in a room if asked', () => {
    const entries = verifySceneModelResult(reportOf(found), { type: 'usage_room' }) as {
      issues: Found[]
    }
    expect(entries.issues.map((issue) => issue.type).sort()).toEqual([
      'usage_turning_narrow',
      'usage_turning_narrow',
    ])
    const turnings = verifySceneModelResult(reportOf(found), {
      type: 'usage_turning_narrow',
      room: 'Closet',
    }) as { issues: Found[]; room: string }
    expect(turnings.room).toBe('Closet')
    expect(turnings.issues).toEqual([turning('Closet', 'zone_closet')])
    const places = verifySceneModelResult(reportOf(found), {
      type: 'usage_passage_narrow',
      room: 'Hall',
    }) as { issues: Found[] }
    expect(places.issues).toHaveLength(1)
  })
})

describe('the words every entry would repeat', () => {
  test('are said once, with the usage entries; an answer without any has none', () => {
    const { usageNote } = shownOf([passage([['Bath', 'zone_bath']]), clash(1, 'warning')])
    expect(usageNote).toBeString()
    expect(usageNote!.match(/indicators/g)).toHaveLength(1)
    const none = verifySceneModelResult(
      reportOf([{ type: 'door_blocked', message: 'Door 9 is blocked', nodeIds: ['door_9'] }]),
      {},
    ) as Record<string, unknown>
    expect('usageNote' in none).toBe(false)
  })

  test('state the thresholds the checks apply', () => {
    const { usageNote } = shownOf([passage([['Bath', 'zone_bath']])])
    const metres = (value: number) => `${value.toFixed(2)} m`
    for (const text of [
      `under ${metres(PASSAGE_M)}`,
      `(${metres(DOOR_M)} through a doorway)`,
      `under ${metres(TURNING_M)}`,
      `8 cm a warning`,
      `within ${Math.round(WINDOW_BLOCK_M * 100)} cm of the glass`,
      `over ${Math.round(WINDOW_ABOVE_SILL_M * 100)} cm above its sill`,
      `before ${OPENS_FULLY_DEG}°`,
      `wants ${metres(BED_ACCESS_M)} at a side`,
      // a doorway is judged on its clear width, and a place on no way to a room has no passage line
      'the limit applies to that clear width, not the door as drawn',
      'a slot or cupboard on no way to a room has none',
    ])
      expect(usageNote).toContain(text)
    expect(CLASH_WARNING_M).toBe(0.08)
  })
})
