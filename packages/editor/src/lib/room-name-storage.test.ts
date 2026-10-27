import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applyZoneTransformPlan,
  createI18n,
  createZone,
  duplicateZone,
  LevelNode,
  type PascalI18n,
  registerMessages,
  setLocale,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { AGENT_OPERATIONS, applyAgentOutcome } from '@pascal-app/core/agent-operations'
import { createAgentHost, liveSceneRuntime } from '@pascal-app/core/runtime'
import {
  commitRoomNameEdit,
  commitRoomNamePick,
  commitTreeRoomRename,
  roomNameOptions,
} from '../components/ui/panels/room-name-options'
import { roomNameSections } from './room-name-catalog'
import { displayRoomName, localizedRoomNameSections } from './room-name-messages'
import { applyRoomPlan, renameRoom } from './room-structure-commands'
import { copySelectedNodesToEditorClipboard, pasteEditorClipboardToLevel } from './scene-clipboard'

/**
 * Every path that writes a room name stores in a French UI what the same edit
 * stores in English (what main stores): the UI only displays catalog names
 * translated. The room panel is driven through the commit and pick functions
 * its name field calls.
 */

const levelId = 'level_names' as LevelNode['id']
const otherLevelId = 'level_names-paste' as LevelNode['id']
const square = (x: number): [number, number][] => [
  [x, 0],
  [x + 4, 0],
  [x + 4, 4],
  [x, 4],
]

const seeded = new Set(['zone_existing', 'zone_new'])
let english: PascalI18n
let french: PascalI18n

beforeAll(async () => {
  // A reviewed French pack for the names these paths touch.
  await registerMessages('fr', '', {
    'editor.roomName.bedroom': 'Chambre',
    'editor.roomName.kitchen': 'Cuisine',
    // Shared labels, as in the French drafts.
    'editor.roomName.livingRoom': 'Salon',
    'editor.roomName.lounge': 'Salon',
    'editor.roomName.office': 'Bureau',
    'editor.roomName.study': 'Bureau',
    'editor.roomName.section.sleeping': 'Nuit',
  })
  english = createI18n({ locale: 'en' })
  french = createI18n({ locale: 'fr' })
})
afterAll(() => {
  setLocale('en')
  english.destroy()
  french.destroy()
})

function seed() {
  const level = LevelNode.parse({ id: levelId, children: ['zone_existing', 'zone_new'] })
  const other = LevelNode.parse({ id: otherLevelId, level: 1 })
  const zone = (id: string, name: string, x: number) =>
    ZoneNode.parse({ id, name, spaceRole: 'room', parentId: levelId, polygon: square(x) })
  const nodes = {
    [level.id]: level,
    [other.id]: other,
    zone_existing: zone('zone_existing', 'Bedroom', 0),
    zone_new: zone('zone_new', '', 10),
  } as unknown as Record<string, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [level.id, other.id], materials: {} } as never)
  useScene.temporal.getState().clear()
}

const nameOf = (id: string) => useScene.getState().nodes[id as AnyNodeId]?.name
const zonesOn = (level: string) =>
  Object.values(useScene.getState().nodes).filter(
    (node) => node.type === 'zone' && node.parentId === level,
  )

/** Runs `write` with the UI in `locale` and returns the names it stored. */
function storedBy(locale: 'en' | 'fr', write: (i18n: PascalI18n) => void) {
  seed()
  setLocale(locale)
  write(locale === 'en' ? english : french)
  setLocale('en')
  // Seeded rooms by id; rooms a path creates get fresh ids, so they are listed by name.
  const zones = Object.values(useScene.getState().nodes).filter((node) => node.type === 'zone')
  return {
    ...Object.fromEntries(
      zones.filter((zone) => seeded.has(zone.id)).map((zone) => [zone.id, zone.name]),
    ),
    created: zones
      .filter((zone) => !seeded.has(zone.id))
      .map((zone) => zone.name ?? '')
      .sort(),
  } as Record<string, string | undefined> & { created: string[] }
}

function expectSameEnglish(write: (i18n: PascalI18n) => void) {
  const inEnglish = storedBy('en', write)
  const inFrench = storedBy('fr', write)
  expect(inFrench).toEqual(inEnglish)
  return inEnglish
}

const sectionsFor = (i18n: PascalI18n, zoneId: string) =>
  localizedRoomNameSections(roomNameSections(useScene.getState().nodes, zoneId), i18n)

/** Types `text` in the panel field and picks the suggestion shown as `label`. */
const pick = (i18n: PascalI18n, zoneId: string, text: string, label = text) => {
  const option = roomNameOptions(text, sectionsFor(i18n, zoneId)).options.find(
    (row) => row.kind === 'suggestion' && row.label === label,
  )
  if (!option) throw new Error(`no suggestion shown as ${label}`)
  commitRoomNamePick(zoneId, nameOf(zoneId) ?? '', option, i18n)
}
/** Types `text` in the panel field and clicks its 'Use "…"' row. */
const useTyped = (i18n: PascalI18n, zoneId: string, text: string) => {
  const typed = roomNameOptions(text, sectionsFor(i18n, zoneId)).typed
  if (!typed) throw new Error(`no typed row for ${text}`)
  commitRoomNamePick(zoneId, nameOf(zoneId) ?? '', typed, i18n)
}
/** Edits the field from what it shows, then blurs it or presses Enter on the typed row. */
const edit = (i18n: PascalI18n, zoneId: string, draft: (shown: string) => string) => {
  const stored = nameOf(zoneId) ?? ''
  const shown = displayRoomName(stored, i18n)
  commitRoomNameEdit(zoneId, stored, shown, draft(shown), i18n)
}
/** Types `text` in the panel field and presses Enter: the active row, as the field does. */
const enter = (i18n: PascalI18n, zoneId: string, text: string) => {
  const stored = nameOf(zoneId) ?? ''
  const { options, active } = roomNameOptions(text, sectionsFor(i18n, zoneId), true, stored)
  const chosen = options[active]
  if (chosen?.kind === 'suggestion') commitRoomNamePick(zoneId, stored, chosen, i18n)
  else commitRoomNameEdit(zoneId, stored, displayRoomName(stored, i18n), text, i18n)
}
const named = (zoneId: string, name: string) => renameRoom(zoneId, name)

describe('room names are stored in English whatever the UI language', () => {
  test('a suggestion pick', () => {
    const names = expectSameEnglish((i18n) =>
      pick(i18n, 'zone_new', i18n === french ? 'Chambre' : 'Bedroom'),
    )
    expect(names.zone_new).toBe('Bedroom 2')
  })

  test('editing the field: renumbering, removing or adding the number', () => {
    const renumber = (i18n: PascalI18n) => {
      named('zone_new', 'Bedroom 2')
      edit(i18n, 'zone_new', (shown) => shown.replace(/2$/, '3'))
    }
    expect(expectSameEnglish(renumber).zone_new).toBe('Bedroom 3')
    const unnumber = (i18n: PascalI18n) => {
      named('zone_new', 'Bedroom 2')
      edit(i18n, 'zone_new', (shown) => shown.replace(/ 2$/, ''))
    }
    expect(expectSameEnglish(unnumber).zone_new).toBe('Bedroom')
    const number = (i18n: PascalI18n) => edit(i18n, 'zone_existing', (shown) => `${shown} 2`)
    expect(expectSameEnglish(number).zone_existing).toBe('Bedroom 2')
  })

  test('a shared translation keeps the room its own name', () => {
    // "Salon" is both Living room and Lounge; "Bureau" both Office and Study.
    const lounge = (i18n: PascalI18n) => {
      named('zone_new', 'Lounge 2')
      edit(i18n, 'zone_new', (shown) => shown.replace(/2$/, '3'))
    }
    expect(expectSameEnglish(lounge).zone_new).toBe('Lounge 3')
    const study = (i18n: PascalI18n) => {
      named('zone_new', 'Study')
      edit(i18n, 'zone_new', (shown) => `${shown} 2`)
    }
    expect(expectSameEnglish(study).zone_new).toBe('Study 2')
  })

  test('Enter on a shared label keeps the room its own entry', () => {
    // "Salon" is shown for both Living room and Lounge; Enter on a Lounge keeps Lounge.
    const lounge = (i18n: PascalI18n) => {
      named('zone_new', 'Lounge')
      enter(i18n, 'zone_new', displayRoomName('Lounge', i18n))
    }
    expect(expectSameEnglish(lounge).zone_new).toBe('Lounge')
    const living = (i18n: PascalI18n) => {
      named('zone_new', 'Living room')
      enter(i18n, 'zone_new', displayRoomName('Living room', i18n))
    }
    expect(expectSameEnglish(living).zone_new).toBe('Living room')
  })

  test('free text, including an exact translation, is stored as typed', () => {
    const atelier = (i18n: PascalI18n) => edit(i18n, 'zone_new', () => 'Atelier de Marie')
    expect(expectSameEnglish(atelier).zone_new).toBe('Atelier de Marie')
    const cuisine = (i18n: PascalI18n) => edit(i18n, 'zone_existing', () => 'Cuisine')
    expect(expectSameEnglish(cuisine).zone_existing).toBe('Cuisine')
    // Another room's translation with a number is not this room's name.
    const salon = (i18n: PascalI18n) => edit(i18n, 'zone_existing', () => 'Salon 2')
    expect(expectSameEnglish(salon).zone_existing).toBe('Salon 2')
  })

  test("clicking 'Use' stores the text as typed; an English name has no 'Use' row", () => {
    expect(storedBy('fr', (i18n) => useTyped(i18n, 'zone_new', 'Chambre')).zone_new).toBe('Chambre')
    expect(storedBy('en', (i18n) => useTyped(i18n, 'zone_new', 'Chambre')).zone_new).toBe('Chambre')
    expect(storedBy('fr', (i18n) => useTyped(i18n, 'zone_new', 'Cuisine')).zone_new).toBe('Cuisine')
    for (const i18n of [english, french]) {
      expect(roomNameOptions('Bedroom', sectionsFor(i18n, 'zone_new')).typed).toBeNull()
    }
  })

  test('surrounding spaces are stored as typed', () => {
    const trailing = (i18n: PascalI18n) => {
      named('zone_new', 'Bedroom 2')
      edit(i18n, 'zone_new', (shown) => shown.replace(/2$/, '3 '))
    }
    expect(expectSameEnglish(trailing).zone_new).toBe('Bedroom 3 ')
    const padded = (i18n: PascalI18n) => {
      named('zone_new', '  Bedroom 2  ')
      edit(i18n, 'zone_new', (shown) => shown.replace('2', '3'))
    }
    expect(expectSameEnglish(padded).zone_new).toBe('  Bedroom 3  ')
  })

  test('the layer tree rename edits the shown name and stores the English', () => {
    /** The tree field shows `displayRoomName`, and passes the trimmed text or undefined. */
    const treeEdit = (i18n: PascalI18n, zoneId: string, draft: (shown: string) => string) => {
      const shown = displayRoomName(nameOf(zoneId) ?? '', i18n)
      const text = draft(shown).trim()
      if (text !== shown) commitTreeRoomRename(zoneId, text || undefined, i18n)
    }
    const renumber = (i18n: PascalI18n) => {
      named('zone_new', 'Lounge 2')
      treeEdit(i18n, 'zone_new', (shown) => shown.replace(/2$/, '3'))
    }
    expect(expectSameEnglish(renumber).zone_new).toBe('Lounge 3')
    const padded = (i18n: PascalI18n) => {
      named('zone_new', '  Kitchen ')
      treeEdit(i18n, 'zone_new', (shown) => shown)
    }
    expect(expectSameEnglish(padded).zone_new).toBe('Kitchen')
    const free = (i18n: PascalI18n) => treeEdit(i18n, 'zone_existing', () => ' Atelier ')
    expect(expectSameEnglish(free).zone_existing).toBe('Atelier')
    const cleared = (i18n: PascalI18n) => treeEdit(i18n, 'zone_existing', () => '')
    expect(expectSameEnglish(cleared).zone_existing).toBeUndefined()
  })

  test('an unchanged field writes nothing', () => {
    for (const name of ['Bedroom', '  Bedroom 2  ', 'Lounge 2', 'Atelier']) {
      seed()
      named('zone_existing', name)
      const before = useScene.getState().nodes
      edit(french, 'zone_existing', (shown) => shown)
      expect(useScene.getState().nodes).toBe(before)
    }
  })

  test('creating a room', () => {
    const names = expectSameEnglish(() => {
      let i = 0
      const plan = createZone(useScene.getState().nodes, {
        levelId,
        polygon: square(20),
        mintId: (kind: string) => `${kind}_created${++i}` as never,
      })
      expect(applyRoomPlan(plan)).toBe(true)
    })
    expect(names.created).toEqual(['Room'])
  })

  test('duplicating a room', () => {
    const names = expectSameEnglish(() => {
      let i = 0
      const mintId = ((kind: string) => `${kind}_copy${++i}`) as never
      // Duplicating needs an enclosed room: build one named as the panel stores it.
      const created = createZone(useScene.getState().nodes, {
        levelId,
        polygon: square(30),
        enclose: true,
        name: 'Bedroom',
        mintId,
      })
      expect(applyRoomPlan(created)).toBe(true)
      const plan = duplicateZone(useScene.getState().nodes, {
        zoneId: created.zoneId,
        translate: [0, 10],
        mintId,
      })
      expect(plan.conflicts).toBeUndefined()
      applyZoneTransformPlan(plan)
    })
    expect(names.created.filter((name) => name.startsWith('Bedroom'))).toHaveLength(2)
  })

  test('copy and paste to another level', () => {
    const names = expectSameEnglish(() => {
      expect(copySelectedNodesToEditorClipboard(['zone_existing' as AnyNodeId])).toBe(true)
      expect(pasteEditorClipboardToLevel(otherLevelId)?.pastedIds.length).toBeGreaterThan(0)
      expect(zonesOn(otherLevelId).map((zone) => zone.name)).toEqual(['Bedroom'])
    })
    expect(names.created).toEqual(['Bedroom'])
  })

  test('MCP and agents: set_zone_intent stores the name as given', () => {
    const names = expectSameEnglish(() => {
      const host = createAgentHost(liveSceneRuntime)
      const outcome = AGENT_OPERATIONS.set_zone_intent(
        host.getNodes(),
        { zoneId: 'zone_new', patch: { name: 'Kitchen' } },
        {} as never,
      )
      applyAgentOutcome(outcome, host)
    })
    expect(names.zone_new).toBe('Kitchen')
  })

  test('undo restores the stored English', () => {
    const names = expectSameEnglish((i18n) => {
      renameRoom('zone_existing', 'Bedroom 4')
      edit(i18n, 'zone_existing', (shown) => shown.replace(/4$/, '5'))
      expect(nameOf('zone_existing')).toBe('Bedroom 5')
      useScene.temporal.getState().undo()
    })
    expect(names.zone_existing).toBe('Bedroom 4')
  })
})
