import type { TreePreset } from './schema'
import { treeThumbnail } from './thumbnails'

/**
 * Per-preset config: which ez-tree built-in preset to generate, a swatch colour,
 * a card `thumbnail` (a replaceable placeholder image — see `thumbnails.ts`), and
 * a default placement height (metres). Pure data — no three.js, no React —
 * shared by the panel grid and the instanced renderer so they stay in lockstep.
 * `ezPreset` is the exact ez-tree preset name passed to `tree.loadPreset(...)`.
 */
export type TreePresetSpec = {
  id: TreePreset
  label: string
  ezPreset: string
  defaultHeight: number
  swatch: string
  thumbnail: string
}

export const TREE_PRESETS: Record<TreePreset, TreePresetSpec> = {
  oak: {
    id: 'oak',
    label: 'Oak',
    ezPreset: 'Oak Medium',
    defaultHeight: 7,
    swatch: '#4f7942',
    thumbnail: treeThumbnail('#4f7942'),
  },
  pine: {
    id: 'pine',
    label: 'Pine',
    ezPreset: 'Pine Medium',
    defaultHeight: 9,
    swatch: '#2f5d3a',
    thumbnail: treeThumbnail('#2f5d3a'),
  },
  aspen: {
    id: 'aspen',
    label: 'Aspen',
    ezPreset: 'Aspen Medium',
    defaultHeight: 8,
    swatch: '#8fae5d',
    thumbnail: treeThumbnail('#8fae5d'),
  },
  ash: {
    id: 'ash',
    label: 'Ash',
    ezPreset: 'Ash Medium',
    defaultHeight: 8,
    swatch: '#6f9457',
    thumbnail: treeThumbnail('#6f9457'),
  },
  bush: {
    id: 'bush',
    label: 'Bush',
    ezPreset: 'Bush 1',
    defaultHeight: 1.5,
    swatch: '#5c8a4a',
    thumbnail: treeThumbnail('#5c8a4a'),
  },
}

export const TREE_PRESET_LIST: TreePresetSpec[] = Object.values(TREE_PRESETS)

/**
 * Bounded seed pool. The placement tool and the Randomize action pick from
 * this set so trees share geometry variants (preset × seed) — that sharing is
 * what makes instancing pay off. A power user can still type an arbitrary seed
 * in the inspector; that tree just renders as its own single-instance variant.
 */
export const TREE_SEED_POOL = [1, 7, 13, 21, 34, 55, 89, 144]

/** Pick a seed from the pool, varied by an index so it stays deterministic
 * (no Math.random in schema-importable code paths). */
export function seedFromPool(index: number): number {
  return TREE_SEED_POOL[Math.abs(index) % TREE_SEED_POOL.length] ?? 1
}
