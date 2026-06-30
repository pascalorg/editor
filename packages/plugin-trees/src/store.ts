import { create } from 'zustand'
import type { TreePreset } from './schema'

/**
 * The plugin's own module-level state — the example of "plugins self-manage
 * runtime state with module-level stores" from the plugin-authoring contract.
 * The presets panel writes the chosen preset here; the placement tool reads it
 * to know which tree to drop. No host lifecycle slot is involved.
 */
type TreesStore = {
  preset: TreePreset
  setPreset: (preset: TreePreset) => void
}

export const useTreesStore = create<TreesStore>((set) => ({
  preset: 'oak',
  setPreset: (preset) => set({ preset }),
}))
