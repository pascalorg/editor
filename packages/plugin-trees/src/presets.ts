import type { TreePreset } from './schema'

/** Per-preset appearance + proportions read by the geometry builder and the
 * presets panel. Pure data — no Three.js, no React — so both the panel grid and
 * the mesh builder stay in lockstep. */
export type TreePresetSpec = {
  id: TreePreset
  label: string
  /** Default overall height in metres when this preset is first placed. */
  defaultHeight: number
  trunkColor: string
  foliageColor: string
  /** Fraction of total height taken by the bare trunk before foliage starts. */
  trunkFraction: number
}

export const TREE_PRESETS: Record<TreePreset, TreePresetSpec> = {
  oak: {
    id: 'oak',
    label: 'Oak',
    defaultHeight: 5,
    trunkColor: '#6b4f3a',
    foliageColor: '#4f7942',
    trunkFraction: 0.4,
  },
  pine: {
    id: 'pine',
    label: 'Pine',
    defaultHeight: 6,
    trunkColor: '#5c4433',
    foliageColor: '#2f5d3a',
    trunkFraction: 0.18,
  },
  birch: {
    id: 'birch',
    label: 'Birch',
    defaultHeight: 5.5,
    trunkColor: '#d8d2c4',
    foliageColor: '#7aa760',
    trunkFraction: 0.5,
  },
  palm: {
    id: 'palm',
    label: 'Palm',
    defaultHeight: 6.5,
    trunkColor: '#9c7a4d',
    foliageColor: '#3f8f5a',
    trunkFraction: 0.82,
  },
}

export const TREE_PRESET_LIST: TreePresetSpec[] = Object.values(TREE_PRESETS)
