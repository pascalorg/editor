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
  /** The gingerbread: what the style hangs on its posts, in its gables, on its front door. */
  trim?: TrimSpec
}

/**
 * THE TRIM A STYLE WEARS (Steve, 2026-09-07: "add some gingerbread to the
 * gables on porches, and gingerbread into the gables on the houses, style
 * more front door options … enhance gingerbread around the houses overall").
 * Every piece is a parametric node the editor already builds — a column's
 * wood-bracket capital, a Y-frame column as a king post with its braces, a
 * door's own panel / glass segments — so nothing needs a mesh in the
 * catalog, and Bones frames none of it (an ornament carries no porch tag).
 */
export type TrimSpec = {
  /** What a porch post carries at its top. */
  postCapital: 'none' | 'wood-bracket'
  /** The ornament in a gable — a king post with two braces under the rakes. */
  gableOrnament: 'none' | 'king-post'
  /** The front door's leaf. */
  frontDoor: FrontDoorStyle
}

export type FrontDoorStyle = 'half-lite' | 'craftsman-lite' | 'six-panel' | 'full-lite' | 'cottage-arch'

const NO_TRIM: TrimSpec = { postCapital: 'none', gableOrnament: 'none', frontDoor: 'six-panel' }

/** The style's trim, or the plain default for a style that declares none. */
export function trimOf(style: Pick<StylePreset, 'trim'>): TrimSpec {
  return style.trim ?? NO_TRIM
}

type DoorSegment = {
  type: 'panel' | 'glass' | 'empty'
  heightRatio: number
  columnRatios: number[]
  dividerThickness: number
  panelDepth: number
  panelInset: number
}

const seg = (type: DoorSegment['type'], heightRatio: number, columnRatios: number[]): DoorSegment => ({
  type,
  heightRatio,
  columnRatios,
  dividerThickness: 0.03,
  panelDepth: 0.01,
  panelInset: 0.04,
})

/**
 * The front door leaves, top to bottom, as the door node builds them:
 * a half-lite (one light over two panels — the farmhouse), the craftsman's
 * three lights over two panels, the six-panel (three rows of two), a
 * full-lite (one light over a kick panel — the moderns), the cottage's
 * four-panel under its arch.
 */
export const FRONT_DOOR_SEGMENTS: Record<FrontDoorStyle, DoorSegment[]> = {
  'half-lite': [seg('glass', 0.45, [1]), seg('panel', 0.55, [1, 1])],
  'craftsman-lite': [seg('glass', 0.32, [1, 1, 1]), seg('panel', 0.68, [1, 1])],
  'six-panel': [seg('panel', 0.3, [1, 1]), seg('panel', 0.35, [1, 1]), seg('panel', 0.35, [1, 1])],
  'full-lite': [seg('glass', 0.86, [1]), seg('panel', 0.14, [1])],
  'cottage-arch': [seg('panel', 0.5, [1, 1]), seg('panel', 0.5, [1, 1])],
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
    trim: { postCapital: 'none', gableOrnament: 'none', frontDoor: 'half-lite' },
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
    trim: { postCapital: 'wood-bracket', gableOrnament: 'king-post', frontDoor: 'craftsman-lite' },
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
    trim: { postCapital: 'none', gableOrnament: 'none', frontDoor: 'six-panel' },
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
    trim: { postCapital: 'none', gableOrnament: 'none', frontDoor: 'full-lite' },
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
    trim: { postCapital: 'none', gableOrnament: 'none', frontDoor: 'full-lite' },
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
    trim: { postCapital: 'wood-bracket', gableOrnament: 'king-post', frontDoor: 'cottage-arch' },
  },
]

export const STYLE_KEYS = STYLES.map((s) => s.key)

export function styleFor(key: string | undefined): StylePreset {
  const found = STYLES.find((s) => s.key === (key ?? '').toLowerCase())
  return found ?? (STYLES[0] as StylePreset)
}
