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
import { pickedRoomName, roomNameOptions } from '../components/ui/panels/room-name-options'
import { roomNameSections } from './room-name-catalog'
import { displayRoomName, localizedRoomNameSections, storedRoomName } from './room-name-messages'
import { applyRoomPlan, renameRoom } from './room-structure-commands'
import { copySelectedNodesToEditorClipboard, pasteEditorClipboardToLevel } from './scene-clipboard'

/**
 * Every path that writes a room name stores the same English in a French UI as
 * in English (what main stores): the UI only displays catalog names translated.
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

/** What the room panel stores for one pick, or for one edit of the field. */
const pick = (i18n: PascalI18n, label: string) => {
  const nodes = useScene.getState().nodes
  const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), i18n)
  const option = roomNameOptions(label, sections).options.find(
    (row) => row.kind === 'suggestion' && row.label === label,
  )!
  renameRoom('zone_new', pickedRoomName(nodes, 'zone_new', option, i18n))
}
const edit = (i18n: PascalI18n, zoneId: string, draft: (shown: string) => string) => {
  const stored = nameOf(zoneId) ?? ''
  const next = storedRoomName(draft(displayRoomName(stored, i18n)), i18n)
  if (next !== stored) renameRoom(zoneId, next)
}

describe('room names are stored in English whatever the UI language', () => {
  test('a suggestion pick', () => {
    const names = expectSameEnglish((i18n) => pick(i18n, i18n === french ? 'Chambre' : 'Bedroom'))
    expect(names.zone_new).toBe('Bedroom 2')
  })

  test('editing the panel field: renumbering, removing the number, free text', () => {
    seed()
    renameRoom('zone_new', 'Bedroom 2')
    const renumber = (i18n: PascalI18n) => {
      renameRoom('zone_new', 'Bedroom 2')
      edit(i18n, 'zone_new', (shown) => shown.replace(/2$/, '3'))
    }
    expect(expectSameEnglish(renumber).zone_new).toBe('Bedroom 3')
    const unnumber = (i18n: PascalI18n) => {
      renameRoom('zone_new', 'Bedroom 2')
      edit(i18n, 'zone_new', (shown) => shown.replace(/ 2$/, ''))
    }
    expect(expectSameEnglish(unnumber).zone_new).toBe('Bedroom')
    const typed = (i18n: PascalI18n) => edit(i18n, 'zone_new', () => 'Atelier de Marie')
    expect(expectSameEnglish(typed).zone_new).toBe('Atelier de Marie')
    // An unchanged field writes nothing.
    seed()
    const before = useScene.getState().nodes
    edit(french, 'zone_existing', (shown) => shown)
    expect(useScene.getState().nodes).toBe(before)
  })

  test('typing exactly a translated name and using it as typed', () => {
    const names = expectSameEnglish((i18n) => {
      const nodes = useScene.getState().nodes
      const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), i18n)
      const typedRow = roomNameOptions(i18n === french ? 'Cuisine' : 'Kitchen', sections).typed!
      renameRoom('zone_new', pickedRoomName(nodes, 'zone_new', typedRow, i18n))
    })
    expect(names.zone_new).toBe('Kitchen')
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
