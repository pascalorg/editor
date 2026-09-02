import { create } from 'zustand'

export type RoofPlacementMode = 'auto' | 'ground' | 'roof'

const MODES: RoofPlacementMode[] = ['auto', 'ground', 'roof']

type RoofPlacementModeState = {
  conical: boolean
  mode: RoofPlacementMode
  cycleMode: () => void
  setConical: (conical: boolean) => void
}

const useRoofPlacementMode = create<RoofPlacementModeState>((set, get) => ({
  conical: false,
  mode: 'auto',
  cycleMode: () => {
    const current = MODES.indexOf(get().mode)
    set({ mode: MODES[(current + 1) % MODES.length] ?? 'auto' })
  },
  setConical: (conical) => set({ conical }),
}))

const subscribeToRoofKind = (onChange: () => void) =>
  useRoofPlacementMode.subscribe((state, previous) => {
    if (state.conical !== previous.conical) onChange()
  })

export const conicalRoofToolHintVisibility = {
  subscribe: subscribeToRoofKind,
  value: () => useRoofPlacementMode.getState().conical,
}

export const standardRoofToolHintVisibility = {
  subscribe: subscribeToRoofKind,
  value: () => !useRoofPlacementMode.getState().conical,
}

export default useRoofPlacementMode
