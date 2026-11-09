import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  baseRoomName,
  numberedRoomName,
  type RoomNameSection,
} from '../../../lib/room-name-catalog'
import {
  type DescriptorTranslator,
  displayRoomName,
  editedRoomName,
} from '../../../lib/room-name-messages'
import { renameRoom } from '../../../lib/room-structure-commands'

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
 * case and surrounding spaces), drops the sections left empty, and puts the
 * typed text first as its own row unless it is exactly an English catalog
 * name. `options` is the flat order the keyboard walks: the typed row, then
 * each group's rows. `current` is the room's stored name.
 */
export function roomNameOptions(
  typed: string,
  sections: readonly RoomNameSection[],
  filtering = true,
  current = '',
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
  const known = sections.some((section) => section.names.includes(typed))
  const typedRow: RoomNameOption | null =
    query && !known ? { kind: 'typed', value: typed, label: typed, match: null } : null
  const options = [...(typedRow ? [typedRow] : []), ...groups.flatMap((group) => group.options)]
  const suggestions = options.filter((option) => option.kind === 'suggestion')
  // Labels can be shared ("Salon" for both Living room and Lounge): a shared
  // label is only an exact match for the room's own name.
  const own = baseRoomName(current).toLowerCase()
  const byLabel = suggestions.filter((option) => option.label.toLowerCase() === query)
  const exactRow =
    suggestions.find((option) => option.value.toLowerCase() === query) ??
    (byLabel.length === 1
      ? byLabel[0]
      : byLabel.find((option) => option.value.toLowerCase() === own))
  const exact = exactRow ? options.indexOf(exactRow) : -1
  return {
    typed: typedRow,
    groups,
    options,
    active: exact >= 0 ? exact : typedRow && options.length > 1 ? 1 : 0,
  }
}

/**
 * The commit of an edited room-name field, on blur or Enter (unless Enter
 * picks a suggestion): the room panel's, and the layer tree's with its own
 * `write`. `committed` is what the field last committed or showed; text still
 * equal to it writes nothing.
 */
export function commitRoomNameEdit(
  zoneId: string,
  name: string,
  committed: string,
  text: string,
  i18n: DescriptorTranslator,
  write: (zoneId: string, name: string) => void = renameRoom,
) {
  if (text === committed) return
  const stored = editedRoomName(name, text, i18n)
  if (stored !== name) write(zoneId, stored)
}

/**
 * The layer tree's rename of a room or zone. Its field shows the name as
 * `displayRoomName` does and passes the trimmed text, or `undefined` when
 * cleared; it writes through `updateNode`, as main's tree does.
 */
export function commitTreeRoomRename(
  zoneId: string,
  text: string | undefined,
  i18n: DescriptorTranslator,
) {
  const { nodes, updateNode } = useScene.getState()
  const id = zoneId as AnyNodeId
  const name = nodes[id]?.name ?? ''
  if (text === undefined) {
    updateNode(id, { name: undefined })
    return
  }
  commitRoomNameEdit(zoneId, name, displayRoomName(name, i18n), text, i18n, (_, stored) =>
    updateNode(id, { name: stored }),
  )
}

/**
 * The room panel's pick of a row: a click, or Enter on a suggestion. A suggestion stores its English catalog name,
 * numbered against the level's other rooms, in every UI language; the typed
 * row stores the text exactly as typed. Returns what the field shows after it.
 */
export function commitRoomNamePick(
  zoneId: string,
  name: string,
  option: RoomNameOption,
  i18n: DescriptorTranslator,
): string {
  const stored =
    option.kind === 'typed'
      ? option.value
      : numberedRoomName(useScene.getState().nodes, zoneId, option.value)
  if (stored !== name) renameRoom(zoneId, stored)
  return displayRoomName(stored, i18n)
}
