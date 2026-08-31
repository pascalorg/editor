import { create } from 'zustand'

export type RoofPlacementMode = 'auto' | 'ground' | 'roof'

const MODES: RoofPlacementMode[] = ['auto', 'ground', 'roof']

type RoofPlacementModeState = {
  mode: RoofPlacementMode
  cycleMode: () => void
}

const useRoofPlacementMode = create<RoofPlacementModeState>((set, get) => ({
  mode: 'auto',
  cycleMode: () => {
    const current = MODES.indexOf(get().mode)
    set({ mode: MODES[(current + 1) % MODES.length] ?? 'auto' })
  },
}))

export default useRoofPlacementMode
