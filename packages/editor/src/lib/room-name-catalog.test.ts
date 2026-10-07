import { describe, expect, test } from 'bun:test'
import { type AnyNode, ZoneNode } from '@pascal-app/core'
import {
  MEZZANINE_NAME_SECTION,
  numberedRoomName,
  ROOM_NAME_SECTIONS,
  roomNameContext,
  roomNameSections,
  roomNameUseCount,
} from './room-name-catalog'

const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
function zone(id: string, patch: Record<string, unknown> = {}) {
  return ZoneNode.parse({
    id,
    name: '',
    spaceRole: 'room',
    parentId: 'level_names',
    polygon: square,
    boundaryWallIds: ['wall_a'],
    ...patch,
  }) as AnyNode
}
const graph = (...zones: AnyNode[]) => Object.fromEntries(zones.map((z) => [z.id, z]))
const ids = (nodes: Record<string, AnyNode>, zoneId: string) =>
  roomNameSections(nodes, zoneId).map((section) => section.id)

describe('room name catalog', () => {
  test('every catalog name is sentence case and listed once', () => {
    const names = ROOM_NAME_SECTIONS.flatMap((section) => section.names)
    expect(new Set(names).size).toBe(names.length)
    for (const name of [...names, ...MEZZANINE_NAME_SECTION.names])
      expect(name[0]).toBe(name[0]!.toUpperCase())
  })

  test('an indoor room lists the catalog in the usual order: no project names, no mezzanine names', () => {
    const nodes = graph(
      zone('zone_a', { name: 'Kitchen' }),
      zone('zone_c', { name: 'Snug' }),
      zone('zone_d', { name: '' }),
    )
    expect(ids(nodes, 'zone_d')).toEqual(ROOM_NAME_SECTIONS.map((s) => s.id))
  })

  test('a picked name that is taken gets the next free number; counts ignore the number', () => {
    const nodes = graph(
      zone('zone_a', { name: 'Bedroom' }),
      zone('zone_b', { name: 'Bedroom 2' }),
      zone('zone_c', { name: 'Kitchen' }),
      zone('zone_self', { name: 'Bedroom 3' }),
    )
    expect(roomNameUseCount(nodes, 'zone_self', 'Bedroom')).toBe(2)
    expect(roomNameUseCount(nodes, 'zone_self', 'Office')).toBe(0)
    expect(numberedRoomName(nodes, 'zone_self', 'Bedroom')).toBe('Bedroom 3')
    expect(numberedRoomName(nodes, 'zone_self', 'Office')).toBe('Office')
    expect(numberedRoomName(nodes, 'zone_c', 'Kitchen')).toBe('Kitchen')
    // Only the level counts: the same name upstairs is not a repeat.
    const upstairs = zone('zone_up', { name: '', parentId: 'level_upstairs' })
    expect(numberedRoomName({ ...nodes, [upstairs.id]: upstairs }, 'zone_up', 'Bedroom')).toBe(
      'Bedroom',
    )
  })

  test('outdoor-looking rooms list Outdoor first', () => {
    const cases = [
      zone('zone_open_sky', { hasCeiling: false }),
      zone('zone_terrace', { boundaryWallIds: [] }),
      zone('zone_outside', { spaceRole: 'generic' }),
    ]
    for (const node of cases) {
      expect(roomNameContext(graph(node), node.id)).toBe('outdoor')
      expect(ids(graph(node), node.id)[0]).toBe('outdoor')
      expect(ids(graph(node), node.id).filter((id) => id === 'outdoor')).toHaveLength(1)
    }
  })

  test('a mezzanine gets the Mezzanine names first; other rooms never see them', () => {
    const mezzanine = zone('zone_mezz', {
      floor: { support: 'open', elevation: 1.4, thickness: 0.2 },
    })
    expect(roomNameContext(graph(mezzanine), mezzanine.id)).toBe('mezzanine')
    expect(ids(graph(mezzanine), mezzanine.id)[0]).toBe('mezzanine')
    expect(ids(graph(zone('zone_room')), 'zone_room')).not.toContain('mezzanine')
  })
})
