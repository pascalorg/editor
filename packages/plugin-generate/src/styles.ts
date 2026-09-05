/**
 * Style presets as data — PlanCrafters' `STYLES` table (gen.js), reduced to
 * what Pascal's nodes can carry today: roof form and pitch, eave overhang,
 * the exterior wall ASSEMBLY (the same presets the Wall panel offers, which
 * is what the elevations and sections read their cladding from), a porch
 * policy and the massing hints the roller uses. Palettes (siding colour,
 * trim, door) are PlanCrafters material ids with no Pascal counterpart yet
 * and are carried as names only.
 */
import type { RoofForm } from './document'

export type StylePreset = {
  key: string
  label: string
  roofForm: Exclude<RoofForm, 'auto'>
  /** Rise in twelfths. */
  pitch: number
  /** Eave overhang, inches. */
  overhangIn: number
  /** Wall assembly preset id (core `WALL_ASSEMBLY_PRESETS`). */
  exteriorAssembly: 'exterior-2x6-siding' | 'exterior-2x6-stucco' | 'exterior-2x6-brick'
  porch: 'full' | 'entry' | 'none'
  /** Ranch-style long-low massing: wider than deep. */
  longLow: boolean
  /** Window-wall living room. */
  bigGlass: boolean
  /** PlanCrafters siding / roofing ids, carried for the finish schedule. */
  siding: string
  roofMat: string
}

export const STYLES: readonly StylePreset[] = [
  {
    key: 'farmhouse',
    label: 'Farmhouse',
    roofForm: 'gable',
    pitch: 8,
    overhangIn: 14,
    exteriorAssembly: 'exterior-2x6-siding',
    porch: 'full',
    longLow: false,
    bigGlass: false,
    siding: 'lap_white',
    roofMat: 'shingle_charcoal',
  },
  {
    key: 'craftsman',
    label: 'Craftsman',
    roofForm: 'gable',
    pitch: 6,
    overhangIn: 24,
    exteriorAssembly: 'exterior-2x6-siding',
    porch: 'entry',
    longLow: false,
    bigGlass: false,
    siding: 'lap_sage',
    roofMat: 'shingle_brown',
  },
  {
    key: 'ranch',
    label: 'Ranch',
    roofForm: 'hip',
    pitch: 4,
    overhangIn: 16,
    exteriorAssembly: 'exterior-2x6-stucco',
    porch: 'entry',
    longLow: true,
    bigGlass: false,
    siding: 'stucco_sage',
    roofMat: 'shingle_green',
  },
  {
    key: 'modern',
    label: 'Modern',
    roofForm: 'hip',
    pitch: 3,
    overhangIn: 20,
    exteriorAssembly: 'exterior-2x6-siding',
    porch: 'none',
    longLow: false,
    bigGlass: true,
    siding: 'lap_black',
    roofMat: 'metal_black',
  },
  {
    key: 'modern-mono',
    label: 'Modern (mono roof)',
    roofForm: 'shed',
    pitch: 2.5,
    overhangIn: 22,
    exteriorAssembly: 'exterior-2x6-stucco',
    porch: 'none',
    longLow: false,
    bigGlass: true,
    siding: 'stucco_gray',
    roofMat: 'metal_gray',
  },
  {
    key: 'cottage',
    label: 'Cottage',
    roofForm: 'gable',
    pitch: 6,
    overhangIn: 12,
    exteriorAssembly: 'exterior-2x6-siding',
    porch: 'entry',
    longLow: false,
    bigGlass: false,
    siding: 'lap_yellow',
    roofMat: 'shingle_charcoal',
  },
]

export const STYLE_KEYS = STYLES.map((s) => s.key)

export function styleFor(key: string | undefined): StylePreset {
  const found = STYLES.find((s) => s.key === (key ?? '').toLowerCase())
  return found ?? (STYLES[0] as StylePreset)
}
