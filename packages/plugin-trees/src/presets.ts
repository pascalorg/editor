import { TREE_ART } from './art'
import type { TreePreset, TreeSize } from './schema'

/**
 * Per-species config: the ez-tree preset name for each size, a default placement
 * height per size (metres), a swatch colour, and a card `thumbnail` (a
 * replaceable placeholder image — see `thumbnails.ts`). Pure data — no three.js,
 * no React — shared by the panel grid and the instanced renderer so they stay in
 * lockstep. `ez[size]` is the exact ez-tree preset name passed to
 * `tree.loadPreset(...)`, exposing all of ez-tree's built-in presets through a
 * clean species × size model. `trellis` has a single preset (size ignored).
 */
export type TreePresetSpec = {
  id: TreePreset
  label: string
  /** ez-tree preset name keyed by size. */
  ez: Record<TreeSize, string>
  /** Default placement height keyed by size. */
  height: Record<TreeSize, number>
  /** Whether the size control applies (false for `trellis`). */
  sized: boolean
  swatch: string
  thumbnail: string
}

function ezSizes(family: string): Record<TreeSize, string> {
  return { small: `${family} Small`, medium: `${family} Medium`, large: `${family} Large` }
}

export const TREE_PRESETS: Record<TreePreset, TreePresetSpec> = {
  oak: {
    id: 'oak',
    label: 'Oak',
    ez: ezSizes('Oak'),
    height: { small: 5, medium: 7, large: 11 },
    sized: true,
    swatch: '#4f7942',
    thumbnail: TREE_ART.oak,
  },
  pine: {
    id: 'pine',
    label: 'Pine',
    ez: ezSizes('Pine'),
    height: { small: 6, medium: 9, large: 14 },
    sized: true,
    swatch: '#2f5d3a',
    thumbnail: TREE_ART.pine,
  },
  aspen: {
    id: 'aspen',
    label: 'Aspen',
    ez: ezSizes('Aspen'),
    height: { small: 5, medium: 8, large: 12 },
    sized: true,
    swatch: '#8fae5d',
    thumbnail: TREE_ART.aspen,
  },
  ash: {
    id: 'ash',
    label: 'Ash',
    ez: ezSizes('Ash'),
    height: { small: 5, medium: 8, large: 12 },
    sized: true,
    swatch: '#6f9457',
    thumbnail: TREE_ART.ash,
  },
  bush: {
    id: 'bush',
    label: 'Bush',
    ez: { small: 'Bush 1', medium: 'Bush 2', large: 'Bush 3' },
    height: { small: 1.2, medium: 1.5, large: 1.8 },
    sized: true,
    swatch: '#5c8a4a',
    thumbnail: TREE_ART.bush,
  },
  trellis: {
    id: 'trellis',
    label: 'Trellis',
    ez: { small: 'Trellis', medium: 'Trellis', large: 'Trellis' },
    height: { small: 3, medium: 3, large: 3 },
    sized: false,
    swatch: '#8b6b45',
    thumbnail: TREE_ART.trellis,
  },
}

export const TREE_PRESET_LIST: TreePresetSpec[] = Object.values(TREE_PRESETS)

/** The ez-tree preset name for a species + size (size ignored for `trellis`). */
export function ezPresetOf(preset: TreePreset, size: TreeSize): string {
  return (TREE_PRESETS[preset] ?? TREE_PRESETS.oak).ez[size]
}

/** Default placement height for a species + size. */
export function defaultHeightOf(preset: TreePreset, size: TreeSize): number {
  return (TREE_PRESETS[preset] ?? TREE_PRESETS.oak).height[size]
}

/**
 * Bounded seed pool. The placement tool and the Randomize action pick from
 * this set so trees share geometry variants — that sharing is what makes
 * instancing pay off. A power user can still type an arbitrary seed in the
 * inspector; that tree just renders as its own single-instance variant.
 */
export const TREE_SEED_POOL = [1, 7, 13, 21, 34, 55, 89, 144]

/** Pick a seed from the pool, varied by an index so it stays deterministic
 * (no Math.random in schema-importable code paths). */
export function seedFromPool(index: number): number {
  return TREE_SEED_POOL[Math.abs(index) % TREE_SEED_POOL.length] ?? 1
}
