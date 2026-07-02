import { FLOWER_ART } from './art'
import type { FlowerPreset } from './flower-schema'

/** Per-flower colours, default height (metres), and a card `thumbnail` (a
 * replaceable placeholder image — see `thumbnails.ts`). Pure data shared by the
 * geometry builder and the panel. */
export type FlowerPresetSpec = {
  id: FlowerPreset
  label: string
  petalColor: string
  centerColor: string
  stemColor: string
  defaultHeight: number
  swatch: string
  thumbnail: string
}

export const FLOWER_PRESETS: Record<FlowerPreset, FlowerPresetSpec> = {
  daisy: {
    id: 'daisy',
    label: 'Daisy',
    petalColor: '#fcfcf2',
    centerColor: '#f4c430',
    stemColor: '#4f7942',
    defaultHeight: 0.5,
    swatch: '#f4c430',
    thumbnail: FLOWER_ART.daisy,
  },
  tulip: {
    id: 'tulip',
    label: 'Tulip',
    petalColor: '#e0457b',
    centerColor: '#c43160',
    stemColor: '#3f7a3a',
    defaultHeight: 0.45,
    swatch: '#e0457b',
    thumbnail: FLOWER_ART.tulip,
  },
  lavender: {
    id: 'lavender',
    label: 'Lavender',
    petalColor: '#9b6fd4',
    centerColor: '#7d52b8',
    stemColor: '#5a7a4a',
    defaultHeight: 0.6,
    swatch: '#9b6fd4',
    thumbnail: FLOWER_ART.lavender,
  },
}

export const FLOWER_PRESET_LIST: FlowerPresetSpec[] = Object.values(FLOWER_PRESETS)

/** Bounded seed pool so flowers share instancing variants (see trees). */
export const FLOWER_SEED_POOL = [1, 7, 13, 21, 34, 55]
