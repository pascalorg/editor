import type { RoomNameSection } from '../../../lib/room-name-catalog'

export type RoomNameOption = {
  kind: 'typed' | 'suggestion'
  value: string
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
    const options = section.names.flatMap((value): RoomNameOption[] => {
      const start = query ? value.toLowerCase().indexOf(query) : -1
      if (query && start < 0) return []
      return [
        {
          kind: 'suggestion',
          value,
          match: start >= 0 ? { start, end: start + query.length } : null,
        },
      ]
    })
    return options.length ? [{ id: section.id, title: section.title, options }] : []
  })
  const known = sections.some((section) => section.names.includes(typed))
  const typedRow: RoomNameOption | null =
    query && !known ? { kind: 'typed', value: typed, match: null } : null
  return {
    typed: typedRow,
    groups,
    options: [...(typedRow ? [typedRow] : []), ...groups.flatMap((group) => group.options)],
  }
}
