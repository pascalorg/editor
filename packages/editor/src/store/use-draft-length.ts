import { create } from 'zustand'

type DraftLengthState = {
  length: number | null
  setLength(length: number | null): void
  clear(): void
}

export const useDraftLength = create<DraftLengthState>((set) => ({
  length: null,
  setLength: (length) =>
    set((state) => {
      if (length !== null && (!Number.isFinite(length) || length < 0.01)) return state
      return length === state.length ? state : { length }
    }),
  clear: () => set((state) => (state.length === null ? state : { length: null })),
}))
