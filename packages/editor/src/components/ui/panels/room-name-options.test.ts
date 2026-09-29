import { describe, expect, test } from 'bun:test'
import type { RoomNameSection } from '../../../lib/room-name-catalog'
import { roomNameOptions } from './room-name-options'

const SECTIONS: RoomNameSection[] = [
  { id: 'living', title: 'Living', names: ['Living room', 'Kitchen', 'Dining room'] },
  { id: 'sleeping', title: 'Sleeping', names: ['Bedroom', 'Guest room'] },
  { id: 'outdoor', title: 'Outdoor', names: ['Garden', 'Terrace'] },
]

const titles = (typed: string) => roomNameOptions(typed, SECTIONS).groups.map((g) => g.title)
const values = (typed: string) => roomNameOptions(typed, SECTIONS).options.map((o) => o.value)

describe('roomNameOptions', () => {
  test('empty or blank input lists every section whole, unmatched, no typed row', () => {
    for (const typed of ['', '   ']) {
      const { typed: row, groups, options } = roomNameOptions(typed, SECTIONS)
      expect(row).toBeNull()
      expect(groups.map((g) => g.title)).toEqual(['Living', 'Sleeping', 'Outdoor'])
      expect(options.map((o) => o.value)).toEqual(SECTIONS.flatMap((s) => s.names))
      expect(options.every((o) => o.kind === 'suggestion' && o.match === null)).toBe(true)
    }
  })

  test('before any typing, the current name does not filter the list', () => {
    const { typed, options } = roomNameOptions('Kitchen', SECTIONS, false)
    expect(typed).toBeNull()
    expect(options.map((o) => o.value)).toEqual(SECTIONS.flatMap((s) => s.names))
  })

  test('typing filters across every section and drops the empty ones', () => {
    expect(titles('room')).toEqual(['Living', 'Sleeping'])
    expect(values('room')).toEqual(['room', 'Living room', 'Dining room', 'Bedroom', 'Guest room'])
    expect(titles('ter')).toEqual(['Outdoor'])
    expect(roomNameOptions('room', SECTIONS).groups[1]?.options[0]?.match).toEqual({
      start: 3,
      end: 7,
    })
  })

  test('free text is always offered first unless it is exactly a name', () => {
    const { typed, options } = roomNameOptions('Wine cellar', SECTIONS)
    expect(typed).toEqual({ kind: 'typed', value: 'Wine cellar', match: null })
    expect(options).toEqual([typed!])
    expect(roomNameOptions('Kitchen', SECTIONS).typed).toBeNull()
    // A case-only difference still offers the text as typed.
    expect(roomNameOptions('kitchen', SECTIONS).typed?.value).toBe('kitchen')
  })

  test('the keyboard order is the typed row, then the groups in order', () => {
    const { groups, options } = roomNameOptions('e', SECTIONS)
    expect(options.slice(1)).toEqual(groups.flatMap((g) => g.options))
    expect(options[0]?.kind).toBe('typed')
  })
})
