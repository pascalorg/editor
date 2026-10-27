import { describe, expect, test } from 'bun:test'
import { type AnyNode, type MessageDescriptor, ZoneNode } from '@pascal-app/core'
import { pickedRoomName, roomNameOptions } from '../components/ui/panels/room-name-options'
import { roomNameSections } from './room-name-catalog'
import { displayRoomName, localizedRoomNameSections, storedRoomName } from './room-name-messages'

const FRENCH: Record<string, string> = {
  'editor.roomName.bedroom': 'Chambre',
  'editor.roomName.kitchen': 'Cuisine',
  'editor.roomName.section.sleeping': 'Nuit',
}
const french = { _: (d: MessageDescriptor) => FRENCH[d.id] ?? d.message ?? d.id }
const english = { _: (d: MessageDescriptor) => d.message ?? d.id }

function zone(id: string, name = '') {
  return ZoneNode.parse({
    id,
    name,
    spaceRole: 'room',
    parentId: 'level_names',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    boundaryWallIds: ['wall_a'],
  }) as AnyNode
}

/** Picks the suggestion the user sees as `label` in a UI language, and returns what it stores. */
function pick(nodes: Record<string, AnyNode>, zoneId: string, i18n: typeof french, label: string) {
  const sections = localizedRoomNameSections(roomNameSections(nodes, zoneId), i18n)
  const option = roomNameOptions(label, sections).options.find(
    (row) => row.kind === 'suggestion' && row.label === label,
  )
  if (!option) throw new Error(`no suggestion shown as ${label}`)
  return pickedRoomName(nodes, zoneId, option, i18n)
}

describe('room-name suggestions in another UI language', () => {
  const nodes = Object.fromEntries(
    [zone('zone_existing', 'Bedroom'), zone('zone_new')].map((node) => [node.id, node]),
  )

  test('a pick stores the same English, numbered name as in English', () => {
    expect(pick(nodes, 'zone_new', english, 'Bedroom')).toBe('Bedroom 2')
    expect(pick(nodes, 'zone_new', french, 'Chambre')).toBe('Bedroom 2')
    expect(pick(nodes, 'zone_new', french, 'Cuisine')).toBe('Kitchen')
  })

  test('the rows show and match the translated labels', () => {
    const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), french)
    const rows = roomNameOptions('chamb', sections).groups.flatMap((group) => group.options)
    expect(rows.map((row) => [row.value, row.label])).toEqual([['Bedroom', 'Chambre']])
    expect(sections.find((section) => section.id === 'sleeping')?.title).toBe('Nuit')
  })

  test('typed text is stored as written', () => {
    const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), french)
    const typed = roomNameOptions('Atelier de Marie', sections).typed
    expect(typed && pickedRoomName(nodes, 'zone_new', typed, french)).toBe('Atelier de Marie')
  })

  test('display translates catalog names and keeps their number; other names show as written', () => {
    expect(displayRoomName('Bedroom 2', french)).toBe('Chambre 2')
    expect(displayRoomName('Bedroom', french)).toBe('Chambre')
    expect(displayRoomName('Bedroom 2', english)).toBe('Bedroom 2')
    expect(displayRoomName('Bedroom of Marie', french)).toBe('Bedroom of Marie')
    expect(displayRoomName('Atelier', french)).toBe('Atelier')
  })
})

describe('editing a translated name in the field', () => {
  test('a catalog name as displayed, with or without a number, stores its English', () => {
    expect(storedRoomName('Chambre 3', french)).toBe('Bedroom 3')
    expect(storedRoomName('Chambre', french)).toBe('Bedroom')
    expect(storedRoomName('Bedroom 3', english)).toBe('Bedroom 3')
    // Anything else is stored as typed, spaces included.
    expect(storedRoomName('Chambre de Marie', french)).toBe('Chambre de Marie')
    expect(storedRoomName('  Atelier  ', french)).toBe('  Atelier  ')
    expect(storedRoomName('chambre', french)).toBe('chambre')
  })
})

describe('a partly translated pack', () => {
  // Only Bedroom is translated; Primary bedroom still shows in English.
  const nodes = Object.fromEntries([zone('zone_new')].map((node) => [node.id, node]))
  const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), french)

  test('typing the English name offers it, active, after the typed row', () => {
    const { options, typed, active } = roomNameOptions('Bedroom', sections)
    expect(typed?.value).toBe('Bedroom')
    expect(options[active]).toMatchObject({
      kind: 'suggestion',
      value: 'Bedroom',
      label: 'Chambre',
    })
    expect(options.map((row) => row.value)).toContain('Primary bedroom')
  })

  test('typing the translated name makes it active too', () => {
    const { options, active } = roomNameOptions('chambre', sections)
    expect(options[active]).toMatchObject({ value: 'Bedroom' })
  })

  test('without an exact name the first suggestion stays active', () => {
    const { options, active } = roomNameOptions('prim', sections)
    expect(options[active]).toMatchObject({ value: 'Primary bedroom' })
  })
})

describe('names that are object prototype keys', () => {
  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf 3'])(
    '%s shows and stores as written',
    (name) => {
      expect(displayRoomName(name, french)).toBe(name)
      expect(displayRoomName(name, english)).toBe(name)
      expect(storedRoomName(name, french)).toBe(name)
    },
  )
})
