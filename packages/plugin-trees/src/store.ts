import { create } from 'zustand'
import { TREE_PRESETS } from './presets'
import type { TreePreset } from './schema'

/**
 * The plugin's own module-level state — the example of "plugins self-manage
 * runtime state with module-level stores" from the plugin-authoring contract.
 * The presets panel writes the chosen preset + placement height here; the
 * placement tool reads them. No host lifecycle slot is involved.
 */
type TreesStore = {
  preset: TreePreset
  /** Height (m) applied to the next planted tree — a per-instance scale, so it
   * never affects already-placed trees or instancing. */
  height: number
  setPreset: (preset: TreePreset) => void
  setHeight: (height: number) => void
}

export const useTreesStore = create<TreesStore>((set) => ({
  preset: 'oak',
  height: TREE_PRESETS.oak.defaultHeight,
  // Switching preset re-seeds the height to that preset's natural default.
  setPreset: (preset) => set({ preset, height: TREE_PRESETS[preset].defaultHeight }),
  setHeight: (height) => set({ height }),
}))
