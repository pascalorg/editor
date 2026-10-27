import type { AnyNode } from '@pascal-app/core'
import { numberedRoomName, type RoomNameSection } from '../../../lib/room-name-catalog'

export type RoomNameOption = {
  kind: 'typed' | 'suggestion'
  /** What a pick stores: the English catalog name, or the typed text as written. */
  value: string
  /** What the row shows and the search matches, in the UI language. */
  label: string
  match: { start: number; end: number } | null
}

export type RoomNameGroup = { id: string; title: string; options: RoomNameOption[] }

/**
 * The room-name combobox's rows. Until the user types, every section is listed
 * whole — the field's current name is not a filter. Typing keeps, in every
 * section, the names containing the text (ignoring case and surrounding
 * spaces), drops the sections left empty, and puts the typed text first as its
 * own row unless it already is one of the names. `options` is the flat order
 * the keyboard walks: the typed row, then each group's rows.
 */
export function roomNameOptions(
  typed: string,
  sections: readonly RoomNameSection[],
  filtering = true,
): { typed: RoomNameOption | null; groups: RoomNameGroup[]; options: RoomNameOption[] } {
  const query = filtering ? typed.trim().toLowerCase() : ''
  const groups = sections.flatMap((section) => {
    const options = section.names.flatMap((value, index): RoomNameOption[] => {
      const label = section.labels?.[index] ?? value
      const start = query ? label.toLowerCase().indexOf(query) : -1
      if (query && start < 0) return []
      return [
        {
          kind: 'suggestion',
          value,
          label,
          match: start >= 0 ? { start, end: start + query.length } : null,
        },
      ]
    })
    return options.length ? [{ id: section.id, title: section.title, options }] : []
  })
  const known = sections.some(
    (section) => section.names.includes(typed) || !!section.labels?.includes(typed),
  )
  const typedRow: RoomNameOption | null =
    query && !known ? { kind: 'typed', value: typed, label: typed, match: null } : null
  return {
    typed: typedRow,
    groups,
    options: [...(typedRow ? [typedRow] : []), ...groups.flatMap((group) => group.options)],
  }
}

/**
 * What a pick writes to the scene: a suggestion's English catalog name, numbered
 * against the level's other rooms, in every UI language; typed text as written.
 */
export function pickedRoomName(
  nodes: Record<string, AnyNode>,
  zoneId: string,
  option: RoomNameOption,
): string {
  return option.kind === 'typed' ? option.value : numberedRoomName(nodes, zoneId, option.value)
}
