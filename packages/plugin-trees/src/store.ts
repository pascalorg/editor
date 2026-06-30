import { create } from 'zustand'
import { FLOWER_PRESETS } from './flower-presets'
import type { FlowerPreset } from './flower-schema'
import { TREE_PRESETS } from './presets'
import type { TreePreset } from './schema'

/**
 * The plugin's own module-level state — the example of "plugins self-manage
 * runtime state with module-level stores" from the plugin-authoring contract.
 * It holds the placement "brush": what the next planted tree looks like. The
 * presets panel writes it; the placement tool reads it. No host lifecycle slot.
 */
type TreesStore = {
  preset: TreePreset
  /** Height (m) of the next tree — a per-instance scale, never affects placed trees. */
  height: number
  /** Leaf-count multiplier vs the preset (folded into the instancing variant). */
  foliageDensity: number
  /** Branch-radius multiplier (folded into the instancing variant). */
  trunkThickness: number
  /** Plant bare (leafless) trees. */
  leafless: boolean
  setPreset: (preset: TreePreset) => void
  setHeight: (height: number) => void
  setFoliageDensity: (value: number) => void
  setTrunkThickness: (value: number) => void
  setLeafless: (value: boolean) => void
  // Flower brush (sibling kind).
  flowerPreset: FlowerPreset
  flowerHeight: number
  setFlowerPreset: (preset: FlowerPreset) => void
  setFlowerHeight: (height: number) => void
}

export const useTreesStore = create<TreesStore>((set) => ({
  preset: 'oak',
  height: TREE_PRESETS.oak.defaultHeight,
  foliageDensity: 1,
  trunkThickness: 1,
  leafless: false,
  // Switching preset re-seeds the height to that preset's natural default; the
  // foliage/trunk brush settings carry over.
  setPreset: (preset) => set({ preset, height: TREE_PRESETS[preset].defaultHeight }),
  setHeight: (height) => set({ height }),
  setFoliageDensity: (foliageDensity) => set({ foliageDensity }),
  setTrunkThickness: (trunkThickness) => set({ trunkThickness }),
  setLeafless: (leafless) => set({ leafless }),
  flowerPreset: 'daisy',
  flowerHeight: FLOWER_PRESETS.daisy.defaultHeight,
  setFlowerPreset: (flowerPreset) =>
    set({ flowerPreset, flowerHeight: FLOWER_PRESETS[flowerPreset].defaultHeight }),
  setFlowerHeight: (flowerHeight) => set({ flowerHeight }),
}))
