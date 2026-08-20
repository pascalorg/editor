import { GRASS_ART } from './art'
import type { GrassPreset } from './grass-schema'

/** Per-grass config: blade colour, blade count per tuft, default height (metres),
 * a swatch, and a replaceable card `thumbnail` (see `thumbnails.ts`). Pure data
 * shared by the geometry builder and the panel. */
export type GrassPresetSpec = {
  id: GrassPreset
  label: string
  bladeColor: string
  blades: number
  defaultHeight: number
  swatch: string
  thumbnail: string
}

export const GRASS_PRESETS: Record<GrassPreset, GrassPresetSpec> = {
  meadow: {
    id: 'meadow',
    label: 'Meadow',
    bladeColor: '#5a8f3c',
    blades: 10,
    defaultHeight: 0.4,
    swatch: '#5a8f3c',
    thumbnail: GRASS_ART.meadow,
  },
  fescue: {
    id: 'fescue',
    label: 'Fescue',
    bladeColor: '#7fae55',
    blades: 8,
    defaultHeight: 0.7,
    swatch: '#7fae55',
    thumbnail: GRASS_ART.fescue,
  },
  reed: {
    id: 'reed',
    label: 'Reed',
    bladeColor: '#4a7d63',
    blades: 6,
    defaultHeight: 1.1,
    swatch: '#4a7d63',
    thumbnail: GRASS_ART.reed,
  },
}

export const GRASS_PRESET_LIST: GrassPresetSpec[] = Object.values(GRASS_PRESETS)

/** Bounded seed pool so grass tufts share instancing variants (see trees). */
export const GRASS_SEED_POOL = [1, 7, 13, 21, 34]
