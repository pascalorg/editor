import { create } from 'zustand'
import { DEFAULT_LENGTH, type LumberOrientation, type LumberSize } from './lumber'

/**
 * The plugin's module-level state — the placement "brush": what the next
 * placed member looks like. The panel writes it; the placement tool reads it.
 * No host lifecycle slot (the plugin-authoring contract's "plugins self-manage
 * runtime state with module-level stores").
 */
type BonesStore = {
  size: LumberSize
  /** Length (m) of the next member. */
  length: number
  orientation: LumberOrientation
  setSize: (size: LumberSize) => void
  setLength: (length: number) => void
  setOrientation: (orientation: LumberOrientation) => void
  /**
   * The host wall mode the user had BEFORE Bones imposed 'down' (Low) at
   * X-ray activation — restored when the view mode goes 'off' or the X-ray
   * is removed (activation.ts owns the contract). Session-scoped UI memory,
   * deliberately NOT persisted on the scene.
   */
  wallModeBeforeXray: string | null
  setWallModeBeforeXray: (mode: string | null) => void
}

export const useBonesStore = create<BonesStore>((set) => ({
  size: '2x4',
  length: DEFAULT_LENGTH,
  orientation: 'stud',
  setSize: (size) => set({ size }),
  setLength: (length) => set({ length }),
  setOrientation: (orientation) => set({ orientation }),
  wallModeBeforeXray: null,
  setWallModeBeforeXray: (mode) => set({ wallModeBeforeXray: mode }),
}))
