import { describe, expect, test } from 'bun:test'
import { type AnyNode, type MessageDescriptor, ZoneNode } from '@pascal-app/core'
import { roomNameOptions } from '../components/ui/panels/room-name-options'
import { roomNameSections } from './room-name-catalog'
import { displayRoomName, editedRoomName, localizedRoomNameSections } from './room-name-messages'

const FRENCH: Record<string, string> = {
  'editor.roomName.bedroom': 'Chambre',
  'editor.roomName.kitchen': 'Cuisine',
  'editor.roomName.livingRoom': 'Salon',
  'editor.roomName.lounge': 'Salon',
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

describe('room-name suggestions in another UI language', () => {
  const nodes = Object.fromEntries(
    [zone('zone_existing', 'Bedroom'), zone('zone_new')].map((node) => [node.id, node]),
  )

  test('the rows show and match the translated labels', () => {
    const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), french)
    const rows = roomNameOptions('chamb', sections).groups.flatMap((group) => group.options)
    expect(rows.map((row) => [row.value, row.label])).toEqual([['Bedroom', 'Chambre']])
    expect(sections.find((section) => section.id === 'sleeping')?.title).toBe('Nuit')
  })

  test('the typed row is offered unless the text is exactly an English name', () => {
    const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), french)
    expect(roomNameOptions('Atelier de Marie', sections).typed?.value).toBe('Atelier de Marie')
    expect(roomNameOptions('Chambre', sections).typed?.value).toBe('Chambre')
    expect(roomNameOptions('Bedroom', sections).typed).toBeNull()
  })

  test('display translates catalog names and keeps their number; other names show as written', () => {
    expect(displayRoomName('Bedroom 2', french)).toBe('Chambre 2')
    expect(displayRoomName('Bedroom', french)).toBe('Chambre')
    expect(displayRoomName('Bedroom 2', english)).toBe('Bedroom 2')
    expect(displayRoomName('Bedroom of Marie', french)).toBe('Bedroom of Marie')
    expect(displayRoomName('Atelier', french)).toBe('Atelier')
    expect(displayRoomName('  Bedroom 2  ', french)).toBe('  Chambre 2  ')
  })
})

describe('editing a translated name in the field', () => {
  test("only the room's own name with a changed number stores English", () => {
    expect(editedRoomName('Bedroom 2', 'Chambre 3', french)).toBe('Bedroom 3')
    expect(editedRoomName('Bedroom 2', 'Chambre', french)).toBe('Bedroom')
    expect(editedRoomName('Bedroom', 'Chambre 2', french)).toBe('Bedroom 2')
    expect(editedRoomName('Bedroom 2', 'Bedroom 3', english)).toBe('Bedroom 3')
  })

  test('a shared translation keeps the room its own name', () => {
    expect(editedRoomName('Lounge 2', 'Salon 3', french)).toBe('Lounge 3')
    expect(editedRoomName('Living room 2', 'Salon 3', french)).toBe('Living room 3')
  })

  test('anything else is stored exactly as typed', () => {
    // A different catalog name's translation, a free-text room, other text, case.
    expect(editedRoomName('Bedroom 2', 'Cuisine', french)).toBe('Cuisine')
    expect(editedRoomName('Atelier', 'Chambre 2', french)).toBe('Chambre 2')
    expect(editedRoomName('Bedroom 2', 'Chambre de Marie', french)).toBe('Chambre de Marie')
    expect(editedRoomName('Bedroom 2', 'chambre 3', french)).toBe('chambre 3')
  })

  test('surrounding spaces are kept as typed, as English keeps them', () => {
    expect(editedRoomName('Bedroom 2', 'Chambre 3 ', french)).toBe('Bedroom 3 ')
    expect(editedRoomName('Bedroom 2', 'Bedroom 3 ', english)).toBe('Bedroom 3 ')
    expect(editedRoomName('  Bedroom 2  ', '  Chambre 3  ', french)).toBe('  Bedroom 3  ')
  })
})

describe('a partly translated pack', () => {
  // Only Bedroom is translated; Primary bedroom still shows in English.
  const nodes = Object.fromEntries([zone('zone_new')].map((node) => [node.id, node]))
  const sections = localizedRoomNameSections(roomNameSections(nodes, 'zone_new'), french)

  test('typing the English name makes it active, with no typed row', () => {
    const { options, typed, active } = roomNameOptions('Bedroom', sections)
    expect(typed).toBeNull()
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

  test('a label two names share is not an exact match', () => {
    const { options, active } = roomNameOptions('salon', sections)
    expect(options[active]?.kind).toBe('suggestion')
    expect(options[active]?.value).toBe(options.find((row) => row.kind === 'suggestion')?.value)
  })
})

describe('names that are object prototype keys', () => {
  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf 3'])(
    '%s shows and stores as written',
    (name) => {
      expect(displayRoomName(name, french)).toBe(name)
      expect(displayRoomName(name, english)).toBe(name)
      expect(editedRoomName(name, `${name} 2`, french)).toBe(`${name} 2`)
    },
  )
})
