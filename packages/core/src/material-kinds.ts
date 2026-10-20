/**
 * The material library's kinds and the surfaces its materials suit, apart from the catalog: an
 * agent tool's contract names them without loading the library it searches.
 */
export const MATERIAL_CATEGORIES = [
  'colors',
  'wood',
  'stone',
  'brick',
  'tile',
  'wallpaper',
  'concrete',
  'metal',
  'plastic',
  'fabric',
  'carpet',
  'leather',
  'roofing',
  'ground',
  'glass',
  'other',
] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

export const MATERIAL_SURFACES = [
  'floor',
  'wall',
  'ceiling',
  'roof',
  'furniture',
  'outdoor',
] as const
export type MaterialSurface = (typeof MATERIAL_SURFACES)[number]
