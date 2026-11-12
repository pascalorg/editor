import type { MessageDescriptor } from '@pascal-app/core'
import { create } from 'zustand'

/**
 * Typed coordinate entry shared by the placement tools: a drafted wall's
 * length/angle and a cabinet's distance/offset along its wall. One session at
 * a time; the active tool owns what the two fields mean and reads them on
 * every change, the HUD (`PlacementCoordinateInput`) only displays them.
 */
export type PlacementTypingField = 0 | 1
export type PlacementTypingValues = [string, string]
export type PlacementTypingProjection = [number, number, number]

export const PLACEMENT_TYPING_DISTANCE_OFFSET: readonly MessageDescriptor[] = [
  /* i18n */ { id: 'editor.placementTyping.distance', message: 'Distance' },
  /* i18n */ { id: 'editor.placementTyping.offset', message: 'Offset' },
]

export const PLACEMENT_TYPING_LENGTH_ANGLE: readonly MessageDescriptor[] = [
  /* i18n */ { id: 'editor.placementTyping.length', message: 'Length' },
  /* i18n */ { id: 'editor.placementTyping.angle', message: 'Angle' },
]

export type PlacementTypingSession = {
  /** What each field means, in field order; the HUD shows one box per label. */
  labels: readonly MessageDescriptor[]
  fieldDefaults?: PlacementTypingValues
  activeField?: PlacementTypingField
}

export type PlacementTypingState = {
  isActive: boolean
  labels: readonly MessageDescriptor[]
  fields: PlacementTypingValues
  /** What an empty field stands for, shown as its placeholder. */
  fieldDefaults: PlacementTypingValues
  activeField: PlacementTypingField
  projectedPosition: PlacementTypingProjection | null
  submitRevision: number
  begin: (session: PlacementTypingSession) => void
  append: (value: string) => void
  backspace: () => void
  setField: (field: PlacementTypingField, value: string) => void
  setActiveField: (field: PlacementTypingField) => void
  toggleField: () => void
  setProjectedPosition: (position: PlacementTypingProjection | null) => void
  requestCommit: () => void
  clear: () => void
}

const EMPTY_VALUES: PlacementTypingValues = ['', '']

export const usePlacementTyping = create<PlacementTypingState>((set) => ({
  isActive: false,
  labels: [],
  fields: [...EMPTY_VALUES],
  fieldDefaults: [...EMPTY_VALUES],
  activeField: 0,
  projectedPosition: null,
  submitRevision: 0,
  begin: ({ labels, fieldDefaults = EMPTY_VALUES, activeField = 0 }) =>
    set({
      isActive: true,
      labels,
      fields: [...EMPTY_VALUES],
      fieldDefaults: [...fieldDefaults],
      activeField,
      projectedPosition: null,
    }),
  append: (value) =>
    set((state) => {
      const fields: PlacementTypingValues = [...state.fields]
      fields[state.activeField] += value
      return { isActive: true, fields }
    }),
  backspace: () =>
    set((state) => {
      const fields: PlacementTypingValues = [...state.fields]
      fields[state.activeField] = fields[state.activeField].slice(0, -1)
      return { fields }
    }),
  setField: (field, value) =>
    set((state) => {
      const fields: PlacementTypingValues = [...state.fields]
      fields[field] = value
      return { isActive: true, fields }
    }),
  setActiveField: (activeField) => set({ activeField }),
  toggleField: () => set((state) => ({ activeField: state.activeField === 0 ? 1 : 0 })),
  setProjectedPosition: (projectedPosition) => set({ projectedPosition }),
  requestCommit: () =>
    set((state: PlacementTypingState) => ({ submitRevision: state.submitRevision + 1 })),
  clear: () =>
    set({
      isActive: false,
      labels: [],
      fields: [...EMPTY_VALUES],
      fieldDefaults: [...EMPTY_VALUES],
      activeField: 0,
      projectedPosition: null,
    }),
}))

/** Keys that extend a field: digits, unit letters, separators, signs, fractions. */
export function isPlacementTypingKey(key: string): boolean {
  return key.length === 1 && /^[0-9a-zA-Z.'"+\-/ ]$/.test(key)
}

/**
 * Keys that may open a session. Letters only ever continue a field, so a
 * tool's single-letter shortcuts keep working until a number is typed.
 */
export function isPlacementTypingStartKey(key: string): boolean {
  return key.length === 1 && /^[0-9.]$/.test(key)
}

export type PlacementTypingKeyOutcome = 'edit' | 'commit' | 'clear'

export type PlacementTypingKeyOptions = {
  /**
   * Opens a session for a start key (or Tab, with `tabBegins`) when none is
   * active. Returns false when the tool cannot take typed entry right now.
   */
  begin?: (activeField: PlacementTypingField) => boolean
  /** Tab with no session opens one on the second field. */
  tabBegins?: boolean
}

/**
 * The one keyboard convention for typed entry. Tab or comma switches field,
 * Enter asks the tool to commit, Escape clears the session (the tool's next
 * Escape cancels its draft), Backspace edits and Delete empties the active
 * field. Chords with Cmd/Ctrl/Alt are never consumed. Returns null when the
 * key is not part of typed entry; the caller prevents default and stops
 * propagation for every other outcome.
 */
export function routePlacementTypingKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  options: PlacementTypingKeyOptions = {},
): PlacementTypingKeyOutcome | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  const typing = usePlacementTyping.getState()
  const { key } = event
  if (!typing.isActive) {
    if (isPlacementTypingStartKey(key)) {
      if (!options.begin?.(0)) return null
      usePlacementTyping.getState().append(key)
      return 'edit'
    }
    if (key === 'Tab' && options.tabBegins && options.begin?.(1)) return 'edit'
    return null
  }
  if (key === 'Tab' || key === ',') {
    typing.toggleField()
    return 'edit'
  }
  if (key === 'Enter') return 'commit'
  if (key === 'Escape') {
    typing.clear()
    return 'clear'
  }
  if (key === 'Backspace') {
    typing.backspace()
    return 'edit'
  }
  if (key === 'Delete') {
    typing.setField(typing.activeField, '')
    return 'edit'
  }
  if (isPlacementTypingKey(key)) {
    typing.append(key)
    return 'edit'
  }
  return null
}

/** Parse options for a typed length: a bare number is read in the display unit. */
export function placementTypingLengthOptions(
  unit: 'metric' | 'imperial',
  metricNotation: 'meters' | 'millimeters',
) {
  return {
    bareUnit: unit === 'imperial' ? 'in' : metricNotation === 'millimeters' ? 'mm' : 'm',
    system: unit === 'imperial' ? ('imperial' as const) : ('metric' as const),
  }
}
