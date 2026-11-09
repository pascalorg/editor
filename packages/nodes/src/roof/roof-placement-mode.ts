import { useEditor } from '@pascal-app/editor'
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

// Read from the roof type the tool is armed with, not from whichever roof tool mounted: in a
// 2D-only session the 3D tool never mounts, and the HUD showed a cone the standard rows.
const isConicalRoof = (state: ReturnType<typeof useEditor.getState>) =>
  state.toolDefaults.roof?.roofType === 'conical'

const subscribeToRoofKind = (onChange: () => void) =>
  useEditor.subscribe((state, previous) => {
    if (isConicalRoof(state) !== isConicalRoof(previous)) onChange()
  })

export const conicalRoofToolHintVisibility = {
  subscribe: subscribeToRoofKind,
  value: () => isConicalRoof(useEditor.getState()),
}

export const standardRoofToolHintVisibility = {
  subscribe: subscribeToRoofKind,
  value: () => !isConicalRoof(useEditor.getState()),
}

export default useRoofPlacementMode
