import { create } from 'zustand'
import { FLOWER_PRESETS } from './flower-presets'
import type { FlowerPreset } from './flower-schema'
import { GRASS_PRESETS } from './grass-presets'
import type { GrassPreset } from './grass-schema'
import { defaultHeightOf, TREE_PRESETS } from './presets'
import type { TreePreset, TreeSize } from './schema'

/**
 * The plugin's own module-level state — the example of "plugins self-manage
 * runtime state with module-level stores" from the plugin-authoring contract.
 * It holds the placement "brush": what the next planted tree/flower looks like.
 * The presets panel writes it; the placement tool reads it. No host lifecycle
 * slot. Colours are intentionally absent — they're edit-only (inspector).
 */
/** Which section of the Nature panel is showing. */
export type TreesPanelMode = 'trees' | 'flowers' | 'grass'

type TreesStore = {
  /** Active panel section — in the store (not panel-local state) so the host's
   * "find in catalog" can land on the right section (see `find-sync.ts`). */
  mode: TreesPanelMode
  setMode: (mode: TreesPanelMode) => void
  preset: TreePreset
  size: TreeSize
  /** Height (m) of the next tree — a per-instance scale, never affects placed trees. */
  height: number
  /** Leaf-count multiplier vs the preset (folded into the instancing variant). */
  foliageDensity: number
  /** Branch-radius multiplier (folded into the instancing variant). */
  trunkThickness: number
  /** Plant bare (leafless) trees. */
  leafless: boolean
  setPreset: (preset: TreePreset) => void
  setSize: (size: TreeSize) => void
  setHeight: (height: number) => void
  setFoliageDensity: (value: number) => void
  setTrunkThickness: (value: number) => void
  setLeafless: (value: boolean) => void
  // Flower brush (sibling kind).
  flowerPreset: FlowerPreset
  flowerHeight: number
  setFlowerPreset: (preset: FlowerPreset) => void
  setFlowerHeight: (height: number) => void
  // Grass brush (sibling kind).
  grassPreset: GrassPreset
  grassHeight: number
  setGrassPreset: (preset: GrassPreset) => void
  setGrassHeight: (height: number) => void
}

export const useTreesStore = create<TreesStore>((set, get) => ({
  mode: 'trees',
  setMode: (mode) => set({ mode }),
  preset: 'oak',
  size: 'medium',
  height: TREE_PRESETS.oak.height.medium,
  foliageDensity: 1,
  trunkThickness: 1,
  leafless: false,
  // Switching preset/size re-seeds the height to that combo's natural default;
  // the foliage/trunk brush settings carry over. Growth model comes from the
  // preset (oak → deciduous, pine → evergreen); override per-tree in the inspector.
  setPreset: (preset) => set({ preset, height: defaultHeightOf(preset, get().size) }),
  setSize: (size) => set({ size, height: defaultHeightOf(get().preset, size) }),
  setHeight: (height) => set({ height }),
  setFoliageDensity: (foliageDensity) => set({ foliageDensity }),
  setTrunkThickness: (trunkThickness) => set({ trunkThickness }),
  setLeafless: (leafless) => set({ leafless }),
  flowerPreset: 'daisy',
  flowerHeight: FLOWER_PRESETS.daisy.defaultHeight,
  setFlowerPreset: (flowerPreset) =>
    set({ flowerPreset, flowerHeight: FLOWER_PRESETS[flowerPreset].defaultHeight }),
  setFlowerHeight: (flowerHeight) => set({ flowerHeight }),
  grassPreset: 'meadow',
  grassHeight: GRASS_PRESETS.meadow.defaultHeight,
  setGrassPreset: (grassPreset) =>
    set({ grassPreset, grassHeight: GRASS_PRESETS[grassPreset].defaultHeight }),
  setGrassHeight: (grassHeight) => set({ grassHeight }),
}))
