import { create } from 'zustand'

export type PlacementTypingField = 0 | 1
export type PlacementTypingValues = [string, string]
export type PlacementTypingProjection = [number, number, number]

export type PlacementTypingState = {
  isActive: boolean
  fields: PlacementTypingValues
  fieldDefaults: PlacementTypingValues
  activeField: PlacementTypingField
  projectedPosition: PlacementTypingProjection | null
  submitRevision: number
  begin: (fieldDefaults?: PlacementTypingValues) => void
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
  fields: [...EMPTY_VALUES],
  fieldDefaults: [...EMPTY_VALUES],
  activeField: 0,
  projectedPosition: null,
  submitRevision: 0,
  begin: (fieldDefaults = EMPTY_VALUES) =>
    set({
      isActive: true,
      fields: [...EMPTY_VALUES],
      fieldDefaults: [...fieldDefaults],
      activeField: 0,
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
      fields: [...EMPTY_VALUES],
      fieldDefaults: [...EMPTY_VALUES],
      activeField: 0,
      projectedPosition: null,
    }),
}))

export function isPlacementTypingKey(key: string): boolean {
  return key.length === 1 && /^[0-9a-zA-Z.'"+\- ]$/.test(key)
}
