/**
 * Finishes — PlanCrafters' curated theme palettes (gen.js PALETTES / STYLES
 * products / model.js materials + STYLE_WINDOWS), applied to the generated
 * house as ONE unit (Steve: "the trim colors and stuff — our general color
 * variable — need to change when they push random too"; "never independent
 * channels — that's how you get clown houses").
 *
 *   - each style carries 4–5 coordinated palettes: siding surface + trim +
 *     door + shutter colours that go together; the seeded roll picks one;
 *   - the siding lands on every exterior wall's `slots.exterior` as a
 *     library material (lap / board-and-batten textures; stucco as a flat
 *     colour on the stucco assembly); the roofing on the roof node's top
 *     surface (comp-shingle / tile textures, standing seam as a metal
 *     material); the trim on the fascia, window frames, painted porch
 *     posts and rails; the door colour on the entrance doors;
 *   - windows take the style's operation type (double-hung for the
 *     farmhouse / craftsman / cottage, sliders for the ranch and modern,
 *     fixed picture glass for the mono-roof modern; a wide low light is a
 *     picture window, a small privacy light a plain slider). Pascal windows
 *     carry no muntin grid, so the style's grid (colonial / craftsman) is
 *     recorded on the building and printed, not drawn;
 *   - wood styles stain the deck rails and stairs (natural / cedar / walnut
 *     / painted) — the deck boards keep the plank texture;
 *   - the product and paint callouts (HardiePlank, Landmark, SW codes) ride
 *     the building's `metadata.finishes` and the run summary.
 *
 * Colours that must be library references (door / window / column slots,
 * the fascia) snap to the NEAREST flat colour preset in Pascal's material
 * library — read from the catalog, never a hand-typed id.
 */
import { MATERIAL_CATALOG } from '@pascal-app/core'
import type { NodeOp } from './build'
import type { StylePreset } from './styles'

export type SidingKind = 'lap' | 'batten' | 'stucco'

export interface Palette {
  /** PlanCrafters siding id (model.js materials). */
  siding: string
  trim: string
  door: string
  shutter: string
  /** What the palette reads as — the panel line. */
  name: string
}

/** PlanCrafters gen.js PALETTES, verbatim (siding id + hexes), named. */
export const PALETTES: Record<string, Palette[]> = {
  farmhouse: [
    {
      siding: 'lap_white',
      trim: '#2d2d2d',
      door: '#1c1c1c',
      shutter: '#1c1c1c',
      name: 'modern farmhouse — white / black',
    },
    {
      siding: 'lap_sage',
      trim: '#f4f1ea',
      door: '#6f5136',
      shutter: '#33413a',
      name: 'sage / cream / walnut door',
    },
    {
      siding: 'lap_navy',
      trim: '#f4f1ea',
      door: '#8d2f23',
      shutter: '#22303f',
      name: 'navy / white / barn-red door',
    },
    {
      siding: 'batten_white',
      trim: '#f4f1ea',
      door: '#33413a',
      shutter: '#33413a',
      name: 'board & batten white / green door',
    },
    {
      siding: 'lap_greige',
      trim: '#f4f1ea',
      door: '#2c2f33',
      shutter: '#2c2f33',
      name: 'greige / white / iron',
    },
  ],
  craftsman: [
    {
      siding: 'lap_sage',
      trim: '#e8e2d2',
      door: '#6f4d2c',
      shutter: '#4a4032',
      name: 'sage / cream / oak',
    },
    {
      siding: 'lap_clay',
      trim: '#e5dfd0',
      door: '#3c4a3c',
      shutter: '#3c4a3c',
      name: 'clay / cream / hunter door',
    },
    {
      siding: 'lap_forest',
      trim: '#d9cdb4',
      door: '#8a5a34',
      shutter: '#2e3a2e',
      name: 'hunter / sand trim / oak door',
    },
    {
      siding: 'lap_greige',
      trim: '#e8e2d2',
      door: '#5a4632',
      shutter: '#4a4032',
      name: 'greige earth tones',
    },
  ],
  ranch: [
    {
      siding: 'stucco_sage',
      trim: '#f4f1ea',
      door: '#6f5136',
      shutter: '#5b5348',
      name: 'sage stucco / cream / walnut door',
    },
    {
      siding: 'stucco_sand',
      trim: '#eceae2',
      door: '#3d4f63',
      shutter: '#5b5348',
      name: 'sand stucco / navy door',
    },
    {
      siding: 'stucco_white',
      trim: '#d8cdb8',
      door: '#8d2f23',
      shutter: '#4a4f55',
      name: 'white stucco / red door',
    },
    {
      siding: 'stucco_adobe',
      trim: '#e6dcc4',
      door: '#4a3a2a',
      shutter: '#6b5842',
      name: 'adobe stucco / walnut',
    },
  ],
  modern: [
    {
      siding: 'lap_black',
      trim: '#3a3d40',
      door: '#8a6a3a',
      shutter: '#2b2d30',
      name: 'dark mono / warm-wood door',
    },
    {
      siding: 'lap_gray',
      trim: '#2c2f33',
      door: '#1c1c1c',
      shutter: '#2b2d30',
      name: 'gray / iron',
    },
    {
      siding: 'batten_charcoal',
      trim: '#54585c',
      door: '#c9762c',
      shutter: '#3a3d40',
      name: 'charcoal batten / ember door',
    },
    {
      siding: 'lap_white',
      trim: '#2c2f33',
      door: '#2c2f33',
      shutter: '#2c2f33',
      name: 'light mono / iron accents',
    },
  ],
  'modern-mono': [
    {
      siding: 'stucco_gray',
      trim: '#3a3d40',
      door: '#8a6a3a',
      shutter: '#2b2d30',
      name: 'smoke stucco / warm-wood door',
    },
    {
      siding: 'stucco_white',
      trim: '#2c2f33',
      door: '#1c1c1c',
      shutter: '#2b2d30',
      name: 'white stucco / iron',
    },
    {
      siding: 'batten_black',
      trim: '#54585c',
      door: '#c9762c',
      shutter: '#3a3d40',
      name: 'black batten / ember door',
    },
    {
      siding: 'lap_gray',
      trim: '#26292c',
      door: '#3d4f63',
      shutter: '#2b2d30',
      name: 'dove gray / navy door',
    },
  ],
  cottage: [
    {
      siding: 'lap_yellow',
      trim: '#f4f1ea',
      door: '#3d4f63',
      shutter: '#33413a',
      name: 'buttercream / navy door',
    },
    {
      siding: 'lap_white',
      trim: '#f4f1ea',
      door: '#3c4a3c',
      shutter: '#3c4a3c',
      name: 'white / hunter door',
    },
    {
      siding: 'lap_sage',
      trim: '#eceae2',
      door: '#8d2f23',
      shutter: '#33413a',
      name: 'sage / red door',
    },
    {
      siding: 'lap_navy',
      trim: '#eceae2',
      door: '#e9d9a8',
      shutter: '#22303f',
      name: 'navy / buttercream door',
    },
    {
      siding: 'lap_gray',
      trim: '#f4f1ea',
      door: '#3c4a3c',
      shutter: '#3c4a3c',
      name: 'dove gray / green',
    },
  ],
}

/**
 * PlanCrafters siding ids → Pascal library materials. Lap and board-and-
 * batten are textured presets (`siding-*`); stucco colours are flat colour
 * presets on the stucco assembly (the library's one stucco texture is
 * white). `label` is PlanCrafters' name for the finish.
 */
export const SIDINGS: Record<
  string,
  { kind: SidingKind; library: string; label: string; hex: string }
> = {
  lap_white: {
    kind: 'lap',
    library: 'siding-lap-white',
    label: 'Lap siding — white',
    hex: '#e8e6df',
  },
  lap_sage: { kind: 'lap', library: 'siding-lap-sage', label: 'Lap siding — sage', hex: '#b9c2ad' },
  lap_navy: { kind: 'lap', library: 'siding-lap-navy', label: 'Lap siding — navy', hex: '#3d4f63' },
  lap_gray: {
    kind: 'lap',
    library: 'siding-lap-gray',
    label: 'Lap siding — dove gray',
    hex: '#aeb4b8',
  },
  lap_black: {
    kind: 'lap',
    library: 'siding-lap-nearblack',
    label: 'Lap siding — iron black',
    hex: '#2e3236',
  },
  lap_yellow: {
    kind: 'lap',
    library: 'siding-lap-yellow',
    label: 'Lap siding — buttercream',
    hex: '#e9d9a8',
  },
  lap_greige: {
    kind: 'lap',
    library: 'siding-lap-greige',
    label: 'Lap siding — greige',
    hex: '#c8c1b8',
  },
  lap_clay: { kind: 'lap', library: 'siding-lap-clay', label: 'Lap siding — clay', hex: '#8f4a2e' },
  lap_forest: {
    kind: 'lap',
    library: 'siding-lap-forest',
    label: 'Lap siding — hunter',
    hex: '#4f6b57',
  },
  batten_white: {
    kind: 'batten',
    library: 'siding-batten-cream',
    label: 'Board & batten — white (cream texture)',
    hex: '#eceae2',
  },
  batten_cream: {
    kind: 'batten',
    library: 'siding-batten-cream',
    label: 'Board & batten — cream',
    hex: '#e5dfd0',
  },
  batten_charcoal: {
    kind: 'batten',
    library: 'siding-batten-charcoal',
    label: 'Board & batten — charcoal',
    hex: '#4a4f55',
  },
  batten_black: {
    kind: 'batten',
    library: 'siding-batten-charcoal',
    label: 'Board & batten — black (charcoal texture)',
    hex: '#2e3236',
  },
  batten_olive: {
    kind: 'batten',
    library: 'siding-batten-olive',
    label: 'Board & batten — olive',
    hex: '#8e9678',
  },
  stucco_sand: { kind: 'stucco', library: 'preset-sand', label: 'Stucco — sand', hex: '#d8cdb8' },
  stucco_white: {
    kind: 'stucco',
    library: 'concrete-stucco',
    label: 'Stucco — white',
    hex: '#e9e7e0',
  },
  stucco_adobe: { kind: 'stucco', library: 'preset-clay', label: 'Stucco — adobe', hex: '#cfa57e' },
  stucco_gray: {
    kind: 'stucco',
    library: 'preset-midgrey',
    label: 'Stucco — smoke',
    hex: '#aeaca4',
  },
  stucco_sage: { kind: 'stucco', library: 'preset-sage', label: 'Stucco — sage', hex: '#b9bda6' },
}

export type RoofFinish = {
  label: string
  hex: string
  /** A textured library preset for the roof top … */
  library?: string
  /** … or a metal material (standing seam has no texture in the library). */
  metal?: boolean
}

/** PlanCrafters roofMat ids → the roof's top surface. */
export const ROOFINGS: Record<string, RoofFinish> = {
  shingle_charcoal: {
    label: 'Comp shingle — charcoal',
    hex: '#59616c',
    library: 'roof-classicshingles',
  },
  shingle_brown: {
    label: 'Comp shingle — weathered',
    hex: '#6e6256',
    library: 'roof-weatheredshingles',
  },
  shingle_green: {
    label: 'Comp shingle — forest (classic texture)',
    hex: '#4c5a4c',
    library: 'roof-classicshingles',
  },
  shingle_slate: {
    label: 'Slate — blue black (classic texture)',
    hex: '#3b4148',
    library: 'roof-classicshingles',
  },
  tile_terra: { label: 'Tile — terracotta', hex: '#b06a44', library: 'roof-terracottatiles' },
  metal_gray: { label: 'Standing seam — gray', hex: '#7d858d', metal: true },
  metal_black: { label: 'Standing seam — matte black', hex: '#2b2e32', metal: true },
  metal_copper: { label: 'Standing seam — copper', hex: '#9a6a44', metal: true },
}

/** PlanCrafters STYLES products + paint codes, per style. */
export const PRODUCTS: Record<
  string,
  { siding: string; roof: string; paint: string; trim: string }
> = {
  farmhouse: {
    siding: 'James Hardie HardiePlank lap siding',
    roof: 'CertainTeed Landmark',
    paint: 'SW 7005',
    trim: 'SW 6258',
  },
  craftsman: {
    siding: 'James Hardie HardieShingle',
    roof: 'CertainTeed Presidential Shake',
    paint: 'SW 7038',
    trim: 'SW 7008',
  },
  ranch: {
    siding: '3-coat stucco system',
    roof: 'CertainTeed Landmark',
    paint: 'SW 6172',
    trim: 'SW 7008',
  },
  modern: {
    siding: 'LP SmartSide ExpertFinish lap',
    roof: 'McElroy Medallion-Lok standing seam',
    paint: 'SW 7069',
    trim: 'SW 7048',
  },
  'modern-mono': {
    siding: '3-coat stucco system',
    roof: 'MBCI LokSeam standing seam',
    paint: 'SW 7674',
    trim: 'SW 7069',
  },
  cottage: {
    siding: 'James Hardie HardiePlank lap siding',
    roof: 'CertainTeed Landmark',
    paint: 'SW 6360',
    trim: 'SW 7005',
  },
}

export type WindowGrid = 'colonial' | 'craftsman' | 'prairie' | 'none'
export type PascalWindowType =
  | 'double-hung'
  | 'single-hung'
  | 'sliding'
  | 'casement'
  | 'awning'
  | 'fixed'

/** PlanCrafters STYLE_WINDOWS: operation type + grid per style. */
export const WINDOW_STYLES: Record<string, { type: PascalWindowType; grid: WindowGrid }> = {
  craftsman: { type: 'double-hung', grid: 'craftsman' },
  farmhouse: { type: 'double-hung', grid: 'colonial' },
  cottage: { type: 'double-hung', grid: 'colonial' },
  ranch: { type: 'sliding', grid: 'none' },
  modern: { type: 'sliding', grid: 'none' },
  'modern-mono': { type: 'fixed', grid: 'none' },
}

export type WoodStyle = 'natural' | 'cedar' | 'walnut' | 'cherry' | 'painted'

/** PlanCrafters wood materials (model.js): the stain the deck rails and stairs take. */
export const WOOD_STYLES: Record<WoodStyle, { label: string; hex: string }> = {
  natural: { label: 'Lumber — natural', hex: '#b08d5f' },
  cedar: { label: 'Lumber — cedar', hex: '#9c7250' },
  walnut: { label: 'Walnut', hex: '#6b4e36' },
  cherry: { label: 'Wood — cherry stained', hex: '#7c3a28' },
  painted: { label: 'Painted wood — trim colour', hex: '' },
}

/** Which wood style a style's decks take. */
export const WOOD_BY_STYLE: Record<string, WoodStyle> = {
  farmhouse: 'painted',
  craftsman: 'cedar',
  ranch: 'natural',
  modern: 'walnut',
  'modern-mono': 'walnut',
  cottage: 'painted',
}

/** The plank texture every wood deck and wood stair takes. */
export const DECK_PLANK_PRESET = 'wood-floorplank1'

export interface Finishes {
  style: string
  palette: number
  paletteName: string
  siding: { id: string; kind: SidingKind; label: string; hex: string; ref: string }
  roof: RoofFinish & { id: string }
  trim: { hex: string; ref: string; preset: string }
  door: { hex: string; ref: string; preset: string }
  shutter: { hex: string; preset: string }
  windows: { type: PascalWindowType; grid: WindowGrid }
  wood: { style: WoodStyle; label: string; hex: string; deckRef: string }
  products: { siding: string; roof: string; paint: string; trim: string }
}

/** The library's flat colour presets, from the catalog (never hand-typed). */
export function colourPresets(): { id: string; hex: string }[] {
  return MATERIAL_CATALOG.filter(
    (m) => m.category === 'colors' && typeof m.previewColor === 'string',
  ).map((m) => ({ id: m.id, hex: m.previewColor as string }))
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = Number.parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  )
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The library colour preset nearest a hex, by RGB distance. */
export function nearestColourPreset(hex: string): string {
  const [r, g, b] = rgb(hex)
  let best = 'preset-white'
  let d = Number.POSITIVE_INFINITY
  for (const p of colourPresets()) {
    const [pr, pg, pb] = rgb(p.hex)
    const dd = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
    if (dd < d) {
      d = dd
      best = p.id
    }
  }
  return best
}

const ref = (id: string) => `library:${id}`

/** Pick the palette for a style: an index (wraps) or 0. */
export function pickPalette(
  style: string,
  index: number | null | undefined,
): { palette: Palette; index: number } {
  const list = PALETTES[style] ?? PALETTES.farmhouse ?? []
  const n = list.length
  const i = n === 0 ? 0 : ((Math.floor(index ?? 0) % n) + n) % n
  return { palette: list[i] as Palette, index: i }
}

/** The finishes for a style and a palette index — one coordinated unit. */
export function finishesFor(style: StylePreset, paletteIndex: number | null | undefined): Finishes {
  const { palette, index } = pickPalette(style.key, paletteIndex)
  const siding =
    SIDINGS[palette.siding] ??
    SIDINGS[style.siding] ??
    (SIDINGS.lap_white as (typeof SIDINGS)[string])
  const roof = ROOFINGS[style.roofMat] ?? (ROOFINGS.shingle_charcoal as RoofFinish)
  const trimPreset = nearestColourPreset(palette.trim)
  const doorPreset = nearestColourPreset(palette.door)
  const woodStyle = WOOD_BY_STYLE[style.key] ?? 'natural'
  const wood = WOOD_STYLES[woodStyle]
  return {
    style: style.key,
    palette: index,
    paletteName: palette.name,
    siding: {
      id: palette.siding,
      kind: siding.kind,
      label: siding.label,
      hex: siding.hex,
      ref: ref(siding.library),
    },
    roof: { id: style.roofMat, ...roof },
    trim: { hex: palette.trim, ref: ref(trimPreset), preset: trimPreset },
    door: { hex: palette.door, ref: ref(doorPreset), preset: doorPreset },
    shutter: { hex: palette.shutter, preset: nearestColourPreset(palette.shutter) },
    windows: WINDOW_STYLES[style.key] ?? { type: 'double-hung', grid: 'colonial' },
    wood: {
      style: woodStyle,
      label: wood.label,
      hex: woodStyle === 'painted' ? palette.trim : wood.hex,
      deckRef: ref(DECK_PLANK_PRESET),
    },
    products: PRODUCTS[style.key] ?? (PRODUCTS.farmhouse as (typeof PRODUCTS)[string]),
  }
}

const IN = 0.0254

/** PlanCrafters stampWindowStyle: the style's type, a picture window for a wide low light, a plain slider for a small privacy light. */
export function windowTypeFor(
  finishes: Finishes,
  widthM: number,
  heightM: number,
): PascalWindowType {
  const w = widthM / IN
  const h = heightM / IN
  if (w >= 60 && h >= 72) return 'fixed'
  if (w <= 30 && h <= 36) return 'sliding'
  return finishes.windows.type
}

type N = Record<string, unknown>
const meta = (n: N) => (n.metadata ?? {}) as Record<string, unknown>
const slotsOf = (n: N) =>
  typeof n.slots === 'object' && n.slots !== null ? (n.slots as Record<string, string>) : {}

/**
 * Apply the finishes to the generated nodes, in place: siding on the
 * exterior walls, roofing + trim on the roof, trim on window frames and
 * painted porch posts, the door colour on the entrances, the wood stain on
 * deck rails and stairs, the plank texture on decks. Returns what changed.
 */
export function applyFinishes(
  ops: NodeOp[],
  f: Finishes,
): {
  walls: number
  windows: number
  doors: number
  roofs: number
  rails: number
  posts: number
  decks: number
} {
  const out = { walls: 0, windows: 0, doors: 0, roofs: 0, rails: 0, posts: 0, decks: 0 }
  for (const op of ops) {
    const n = op.node as N
    const m = meta(n)
    switch (n.type) {
      case 'wall':
        if (m.wallType === 'ext2x6') {
          n.slots = { ...slotsOf(n), exterior: f.siding.ref }
          out.walls++
        }
        break
      case 'window': {
        n.slots = { ...slotsOf(n), frame: f.trim.ref }
        n.windowType = windowTypeFor(f, Number(n.width ?? 0), Number(n.height ?? 0))
        out.windows++
        break
      }
      case 'door': {
        if (m.attach === 'exterior') {
          n.slots = { ...slotsOf(n), panel: f.door.ref }
          out.doors++
        } else if (m.attach === 'garage') {
          n.slots = { ...slotsOf(n), panel: f.trim.ref }
          out.doors++
        }
        break
      }
      case 'roof': {
        if (f.roof.library) {
          n.topMaterialPreset = ref(f.roof.library)
        } else {
          n.topMaterial = {
            preset: 'metal',
            properties: { color: f.roof.hex, roughness: 0.55, metalness: 0.45 },
          }
        }
        n.edgeMaterialPreset = f.trim.ref
        out.roofs++
        break
      }
      case 'column': {
        if (typeof n.materialPreset !== 'string') {
          n.materialPreset = f.trim.ref
          out.posts++
        }
        break
      }
      case 'fence': {
        const onDeck = /deck/i.test(String(n.name ?? ''))
        n.color = onDeck && f.wood.style !== 'painted' ? f.wood.hex : f.trim.hex
        out.rails++
        break
      }
      case 'slab': {
        if (m.floor === 'deck') {
          n.materialPreset = f.wood.deckRef
          out.decks++
        }
        break
      }
      case 'stair': {
        if (String(n.materialPreset ?? '').includes(DECK_PLANK_PRESET))
          n.materialPreset = f.wood.deckRef
        break
      }
    }
  }
  return out
}

/** One line for the run summary and the panel. */
export function describeFinishes(f: Finishes): string {
  const grid = f.windows.grid === 'none' ? '' : `, ${f.windows.grid} grid (recorded, not drawn)`
  return `${f.paletteName}: ${f.siding.label.toLowerCase()} · ${f.roof.label.toLowerCase()} · trim ${f.trim.hex} · door ${f.door.hex} · windows ${f.windows.type}${grid} · rails ${f.wood.style === 'painted' ? 'painted trim' : f.wood.label.toLowerCase()} · ${f.products.siding} / ${f.products.roof} · paint ${f.products.paint}, trim ${f.products.trim}`
}
