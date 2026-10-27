import type { AnyNode } from '@pascal-app/core'
import { numberedRoomName, type RoomNameSection } from '../../../lib/room-name-catalog'
import { type DescriptorTranslator, storedRoomName } from '../../../lib/room-name-messages'

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
 * section, the names whose label or English name contains the text (ignoring
 * case and surrounding spaces), drops the sections left empty, and always puts
 * the typed text first as its own row. `options` is the flat order the
 * keyboard walks: the typed row, then each group's rows.
 */
export function roomNameOptions(
  typed: string,
  sections: readonly RoomNameSection[],
  filtering = true,
): {
  typed: RoomNameOption | null
  groups: RoomNameGroup[]
  options: RoomNameOption[]
  /** The row Enter picks after typing: an exact name, else the first suggestion. */
  active: number
} {
  const query = filtering ? typed.trim().toLowerCase() : ''
  const groups = sections.flatMap((section) => {
    const options = section.names.flatMap((value, index): RoomNameOption[] => {
      const label = section.labels?.[index] ?? value
      // The label is what is shown and highlighted; the English name matches too,
      // for packs that have not translated every name yet.
      const start = query ? label.toLowerCase().indexOf(query) : -1
      if (query && start < 0 && !value.toLowerCase().includes(query)) return []
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
  const typedRow: RoomNameOption | null = query
    ? { kind: 'typed', value: typed, label: typed, match: null }
    : null
  const options = [...(typedRow ? [typedRow] : []), ...groups.flatMap((group) => group.options)]
  const exact = options.findIndex(
    (option) =>
      option.kind === 'suggestion' &&
      (option.value.toLowerCase() === query || option.label.toLowerCase() === query),
  )
  return {
    typed: typedRow,
    groups,
    options,
    active: exact >= 0 ? exact : typedRow && options.length > 1 ? 1 : 0,
  }
}

/**
 * What a pick writes to the scene: a suggestion's English catalog name, numbered
 * against the level's other rooms, in every UI language. Typed text is stored
 * as written, except a catalog name as displayed, which stores its English.
 */
export function pickedRoomName(
  nodes: Record<string, AnyNode>,
  zoneId: string,
  option: RoomNameOption,
  i18n: DescriptorTranslator,
): string {
  return option.kind === 'typed'
    ? storedRoomName(option.value, i18n)
    : numberedRoomName(nodes, zoneId, option.value)
}
