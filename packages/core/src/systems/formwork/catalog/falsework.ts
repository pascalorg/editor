import type { CapacityBasis, CatalogEntry } from './types'

/**
 * What holds a soffit up: the sheathing, the beams under it, and the props under
 * those. A wall's parts are rated by pressure; a deck's are rated by moment,
 * shear and stiffness, so none of `PanelType` fits and this is a separate family.
 *
 * Two things here are deliberately awkward, because the real products are:
 *
 * A prop's capacity is a lookup, not a formula. It falls as the prop extends and
 * then *rises* again where a shorter, stiffer tube configuration takes over, and
 * it differs by which end the outer tube is at — flipping a Eurex upside down
 * gains capacity. products.md §1.7 has the table; interpolating a curve through
 * it would invent capacity in the dip, which is exactly where a deck fails.
 *
 * Plywood design values are product-specific and are *not* shipped as fact. The
 * APA Plyform grades are published and verified; the metric film-faced entries
 * are a stated typical range from design.md §2.2 flagged `unverified`, present so
 * a model built in mm has something to run against, and meant to be replaced by a
 * manufacturer's declaration. See open item 3.
 *
 * See `wiki/formwork/reference/design.md` §2.2–2.3 and `products.md` §1.7, §2.2.
 */

/**
 * A sheet's structural properties per metre of width, in the direction its face
 * grain runs. Orientation is a design input rather than a detail: 3/4″ Class I
 * loses 54 % of its `I` turned the wrong way, and 46 % of its allowable pressure
 * with it, so both directions are carried and the layout has to say which it used.
 */
export interface SheathingDirection {
  /** Bending resistance per m of width, kNm/m. */
  momentKnMPerM: number
  /** Rolling-shear resistance per m of width, kN/m. */
  shearKnPerM: number
  /** Flexural rigidity per m of width, kNm²/m. */
  eiKnM2PerM: number
}

export interface SheathingType extends CatalogEntry {
  thicknessMm: number
  /** Face grain across the supports — the strong direction, and the intended one. */
  acrossSupports: SheathingDirection
  /** Face grain parallel to the supports. Substantially weaker; never the default. */
  parallelToSupports: SheathingDirection
  capacityBasis: CapacityBasis
  sourceRef: string
}

/**
 * A falsework beam — an H20 timber I-beam or a lumber joist. Lengths matter as
 * much as capacity: the series is not uniform (1450, 1800, 2450, 2650, 2900…) so a
 * deck laid out on a round module wastes the difference on every beam, and a
 * cut-to-length charge is a real BOM line.
 */
export interface FalseworkBeamType extends CatalogEntry {
  depthMm: number
  widthMm: number
  /** Bending resistance, kNm. */
  momentKnM: number
  /** Shear resistance, kN. */
  shearKn: number
  /** Flexural rigidity, kNm². */
  eiKnM2: number
  kgPerM: number
  /** Stock lengths, mm. Non-uniform by design — see the module note. */
  lengthsMm: readonly number[]
  cutToLengthSupported: boolean
  capacityBasis: CapacityBasis
  sourceRef: string
}

/**
 * One row of a prop's capacity table: the load it takes at a given extension,
 * with the outer tube at the bottom and at the top. `undefined` where the
 * manufacturer publishes no figure for that configuration at that length.
 */
export interface PropCapacityRow {
  lengthM: number
  bottomKn?: number
  topKn?: number
}

export interface PropType extends CatalogEntry {
  minLengthM: number
  maxLengthM: number
  /**
   * Capacity against extension. Stored, never fitted: the series dips mid-range
   * and rises again, so a formula through these points would over-state the dip.
   */
  capacities: readonly PropCapacityRow[]
  /** EN 1065 designation, e.g. `30-350` — class kN and max length cm. */
  en1065Class?: string
  capacityBasis: CapacityBasis
  sourceRef: string
}

const PLY_SOURCE = 'wiki/formwork/reference/design.md §2.2 — APA Tables 12–13'
const METRIC_PLY_SOURCE =
  'wiki/formwork/reference/design.md §2.2 — stated typical range for film-faced ply, not a manufacturer declaration'

/**
 * APA Plyform section properties are published per foot of width in mixed units.
 * These are converted once, here, rather than at every call site: `KS` in in³/ft
 * and `I` in in⁴/ft against `Fb`, `Fs` and `E` in psi.
 *
 * Each factor is the product of its own unit chain rather than a remembered
 * constant, because the intermediate is a compound unit nobody has intuition for
 * — `in³/ft × psi` is `lbf·in/ft` — and a wrong factor here does not look wrong.
 * It shows up as a plywood sheet spanning four metres.
 *
 * The concrete setting factor `Cs = 1.625` is *already applied* to the wet
 * stresses APA tabulates (duration-of-load 1.25 × experience 1.30), so it is not
 * applied again here. Applying it twice is a 63 % over-strength error that
 * reproduces none of the published tables.
 */

/** `lbf·in/ft` → `kNm/m`: pound-inch to newton-metre, then per-foot to per-metre. */
const LBF_IN_PER_FT_TO_KNM_PER_M = 0.1129848 * (1 / 0.3048) * 1e-3

/** `lbf/ft` → `kN/m`. */
const LBF_PER_FT_TO_KN_PER_M = 4.44822 * (1 / 0.3048) * 1e-3

/** `lbf·in²/ft` → `kNm²/m`. */
const LBF_IN2_PER_FT_TO_KNM2_PER_M = 4.44822 * 0.0254 ** 2 * (1 / 0.3048) * 1e-3

function fromApa(
  ksIn3PerFt: number,
  ibqIn2PerFt: number,
  iIn4PerFt: number,
  fbPsi: number,
  fsPsi: number,
  ePsi: number,
): SheathingDirection {
  return {
    momentKnMPerM: Number((ksIn3PerFt * fbPsi * LBF_IN_PER_FT_TO_KNM_PER_M).toFixed(4)),
    shearKnPerM: Number((ibqIn2PerFt * fsPsi * LBF_PER_FT_TO_KN_PER_M).toFixed(3)),
    eiKnM2PerM: Number((iIn4PerFt * ePsi * LBF_IN2_PER_FT_TO_KNM2_PER_M).toFixed(4)),
  }
}

/**
 * Metric film-faced ply from `f_m`, `f_r` and `E_mean` on a solid section — the
 * derivation design.md gives, because no published metric span table was
 * obtainable. `W = 1000·t²/6` and `I = 1000·t³/12` per metre of width.
 *
 * Solid-section properties over-state a plywood panel's cross-grain direction,
 * which is why the parallel-to-supports entries below are factored down from an
 * APA ratio rather than computed the same way.
 */
function fromMetric(
  thicknessMm: number,
  fmNMm2: number,
  frNMm2: number,
  eMeanNMm2: number,
): SheathingDirection {
  const wMm3 = (1000 * thicknessMm ** 2) / 6
  const iMm4 = (1000 * thicknessMm ** 3) / 12
  return {
    // N·mm → kNm: ×1e-6.
    momentKnMPerM: Number((fmNMm2 * wMm3 * 1e-6).toFixed(4)),
    // Rolling shear over the full section, N → kN.
    shearKnPerM: Number(((frNMm2 * 1000 * thicknessMm * (2 / 3)) / 1000).toFixed(3)),
    // N/mm² × mm⁴ → kNm²: ×1e-9.
    eiKnM2PerM: Number((eMeanNMm2 * iMm4 * 1e-9).toFixed(4)),
  }
}

/** The cross-grain penalty APA's own tables show at 3/4″: 0.092/0.199 on `I`. */
const CROSS_GRAIN_I = 0.462
const CROSS_GRAIN_KS = 0.673

function weaker(strong: SheathingDirection): SheathingDirection {
  return {
    momentKnMPerM: Number((strong.momentKnMPerM * CROSS_GRAIN_KS).toFixed(4)),
    shearKnPerM: Number((strong.shearKnPerM * 0.565).toFixed(3)),
    eiKnM2PerM: Number((strong.eiKnM2PerM * CROSS_GRAIN_I).toFixed(4)),
  }
}

/** 3/4″ Plyform Class I — the grade APA's worked example is built on. */
export const PLYFORM_CLASS_I_19MM: SheathingType = {
  id: 'plyform-class-i-3-4',
  manufacturer: 'APA',
  systemFamily: 'Plyform',
  label: 'Plyform Class I, 3/4 in (19 mm)',
  weightKg: 10.7,
  catalogSource: 'APA Concrete Forming Design/Construction Guide, Tables 12–13',
  verification: 'verified',
  thicknessMm: 19.05,
  acrossSupports: fromApa(0.455, 7.187, 0.199, 1930, 72, 1_650_000),
  parallelToSupports: fromApa(0.306, 4.063, 0.092, 1930, 72, 1_650_000),
  capacityBasis: 'permissible',
  sourceRef: PLY_SOURCE,
}

/** Structural I Plyform, 3/4″ — the same section at 102 psi rolling shear rather than 72. */
export const PLYFORM_STRUCTURAL_I_19MM: SheathingType = {
  id: 'plyform-structural-i-3-4',
  manufacturer: 'APA',
  systemFamily: 'Plyform',
  label: 'Structural I Plyform, 3/4 in (19 mm)',
  weightKg: 10.7,
  catalogSource: 'APA Concrete Forming Design/Construction Guide, Tables 12–13',
  verification: 'verified',
  thicknessMm: 19.05,
  acrossSupports: fromApa(0.464, 6.189, 0.202, 1930, 102, 1_650_000),
  parallelToSupports: fromApa(0.418, 4.047, 0.108, 1930, 102, 1_650_000),
  capacityBasis: 'permissible',
  sourceRef: PLY_SOURCE,
}

/**
 * 18 mm film-faced ply on the mid-range of design.md's stated band — `f_m` 30,
 * rolling shear 2.4, `E_mean` 7500.
 *
 * ⚠️ These are not published design values for any product. They are here so a
 * metric model has a runnable default and they are `unverified` on purpose;
 * replace with a Metsä WISA-Form, UPM or Doka declaration before certifying.
 */
export const FILM_FACED_PLY_18MM: SheathingType = {
  id: 'film-faced-ply-18',
  manufacturer: 'generic',
  systemFamily: 'film-faced plywood',
  label: 'Film-faced plywood 18 mm (typical values — unverified)',
  weightKg: 11,
  catalogSource: 'derived from a stated typical property range, not a product datasheet',
  verification: 'unverified',
  thicknessMm: 18,
  acrossSupports: fromMetric(18, 30, 2.4, 7500),
  parallelToSupports: weaker(fromMetric(18, 30, 2.4, 7500)),
  capacityBasis: 'permissible',
  sourceRef: METRIC_PLY_SOURCE,
}

/** 21 mm film-faced ply, same basis and the same caveat. */
export const FILM_FACED_PLY_21MM: SheathingType = {
  id: 'film-faced-ply-21',
  manufacturer: 'generic',
  systemFamily: 'film-faced plywood',
  label: 'Film-faced plywood 21 mm (typical values — unverified)',
  weightKg: 13,
  catalogSource: 'derived from a stated typical property range, not a product datasheet',
  verification: 'unverified',
  thicknessMm: 21,
  acrossSupports: fromMetric(21, 30, 2.4, 7500),
  parallelToSupports: weaker(fromMetric(21, 30, 2.4, 7500)),
  capacityBasis: 'permissible',
  sourceRef: METRIC_PLY_SOURCE,
}

export const SHEATHING_TYPES: readonly SheathingType[] = [
  FILM_FACED_PLY_18MM,
  FILM_FACED_PLY_21MM,
  PLYFORM_CLASS_I_19MM,
  PLYFORM_STRUCTURAL_I_19MM,
]

export const DEFAULT_SHEATHING_ID = FILM_FACED_PLY_18MM.id

export function sheathingType(id: string): SheathingType | undefined {
  return SHEATHING_TYPES.find((entry) => entry.id === id)
}

/**
 * Doka H20 beam on its *permissible* figures — 5 kNm, 11 kN, 450 kNm².
 *
 * products.md §2.2 records the conflict: PERI-branded sheets publish 11 kNm and
 * 24 kN for the same beam, which are characteristic resistances rather than
 * permissible loads. Taking those against a working load over-spans a deck by
 * about a factor of two, so the permissible pair is the default and `capacityBasis`
 * is what a consumer must read before comparing anything to it.
 */
export const H20_BEAM: FalseworkBeamType = {
  id: 'h20-doka-permissible',
  manufacturer: 'Doka',
  systemFamily: 'H20',
  label: 'Timber beam H20 (permissible values)',
  weightKg: 5.5,
  catalogSource: 'Doka beam H20 top, EN 13377',
  verification: 'secondary',
  depthMm: 200,
  widthMm: 80,
  momentKnM: 5,
  shearKn: 11,
  eiKnM2: 450,
  kgPerM: 5.5,
  lengthsMm: [1450, 1800, 2450, 2650, 2900, 3300, 3600, 3900, 4500, 4900, 5900],
  cutToLengthSupported: true,
  capacityBasis: 'permissible',
  sourceRef: 'wiki/formwork/reference/products.md §2.2 — permissible/design conflict recorded',
}

/** H16 — the shallower beam, scaled on section rather than published separately. */
export const H16_BEAM: FalseworkBeamType = {
  ...H20_BEAM,
  id: 'h16-permissible',
  label: 'Timber beam H16 (permissible values)',
  verification: 'unverified',
  depthMm: 160,
  momentKnM: 3.6,
  shearKn: 9,
  eiKnM2: 260,
  kgPerM: 4.5,
  weightKg: 4.5,
  catalogSource: 'scaled from H20 on section depth — no published H16 table obtained',
}

export const FALSEWORK_BEAMS: readonly FalseworkBeamType[] = [H16_BEAM, H20_BEAM]

export const DEFAULT_FALSEWORK_BEAM_ID = H20_BEAM.id

export function falseworkBeam(id: string): FalseworkBeamType | undefined {
  return FALSEWORK_BEAMS.find((entry) => entry.id === id)
}

/**
 * The shortest stock length that reaches `spanM`, mm — and `undefined` where
 * nothing does, which means the run needs a splice over a prop rather than a
 * longer beam. The series has no constant step, so this is a search rather than a
 * rounding.
 */
export function beamLengthForSpanMm(beam: FalseworkBeamType, spanM: number): number | undefined {
  const needMm = spanM * 1000
  return beam.lengthsMm.find((length) => length >= needMm)
}

/**
 * Doka Eurex 30 top, per approval Z-8.311-942. The dip at 2.5–4.5 m and the rise
 * at 5.0 m are in the published table, not an error — which is the whole reason
 * this is stored rather than fitted.
 */
export const EUREX_30: PropType = {
  id: 'eurex-30-top',
  manufacturer: 'Doka',
  systemFamily: 'Eurex',
  label: 'Doka floor prop Eurex 30 top',
  weightKg: 18.5,
  catalogSource: 'Doka Floor-prop-Eurex permissible load capacity, approval Z-8.311-942',
  verification: 'verified',
  minLengthM: 1.5,
  maxLengthM: 5.5,
  capacities: [
    { lengthM: 1.5, topKn: 41.2 },
    { lengthM: 2.0, bottomKn: 37.0 },
    { lengthM: 2.5, bottomKn: 30.9, topKn: 37.0 },
    { lengthM: 3.0, bottomKn: 30.9, topKn: 34.8 },
    { lengthM: 3.5, bottomKn: 30.9, topKn: 34.2 },
    { lengthM: 4.0, bottomKn: 31.5, topKn: 34.2 },
    { lengthM: 4.5, bottomKn: 32.7, topKn: 34.5 },
    { lengthM: 5.0, bottomKn: 41.2, topKn: 41.2 },
    { lengthM: 5.5, bottomKn: 31.8, topKn: 33.3 },
  ],
  en1065Class: '30-550',
  capacityBasis: 'permissible',
  sourceRef: 'wiki/formwork/reference/products.md §1.7',
}

/** Doka Eurex 20 top — the lighter prop, same non-monotonic shape. */
export const EUREX_20: PropType = {
  id: 'eurex-20-top',
  manufacturer: 'Doka',
  systemFamily: 'Eurex',
  label: 'Doka floor prop Eurex 20 top',
  weightKg: 14.2,
  catalogSource: 'Doka Floor-prop-Eurex permissible load capacity',
  verification: 'secondary',
  minLengthM: 1.5,
  maxLengthM: 5.5,
  capacities: [
    { lengthM: 3.0, bottomKn: 20.7, topKn: 24.8 },
    { lengthM: 4.0, bottomKn: 21.5, topKn: 24.8 },
    { lengthM: 4.5, bottomKn: 33.2, topKn: 36.7 },
    { lengthM: 5.0, bottomKn: 25.8, topKn: 29.4 },
    { lengthM: 5.5, bottomKn: 20.6, topKn: 22.7 },
  ],
  en1065Class: '20-550',
  capacityBasis: 'permissible',
  sourceRef: 'wiki/formwork/reference/products.md §1.7',
}

export const PROP_TYPES: readonly PropType[] = [EUREX_20, EUREX_30]

export const DEFAULT_PROP_ID = EUREX_30.id

export function propType(id: string): PropType | undefined {
  return PROP_TYPES.find((entry) => entry.id === id)
}

/**
 * What a prop takes at `lengthM`, kN — and `undefined` when the prop does not
 * reach that length at all.
 *
 * Rounded *up* to the next tabulated row rather than interpolated, because
 * capacity falls with extension and the table dips: a prop at 3.2 m is checked
 * against the 3.5 m row, which is the conservative reading of a non-monotonic
 * series. Interpolating between 3.0 and 3.5 would be defensible here and wrong at
 * 4.5–5.0, where the real capacity climbs 25 % between adjacent rows.
 *
 * `orientation` is which end the outer tube is at. It is not cosmetic — flipping a
 * Eurex 30 at 2.5 m gains 20 % — so a deck designed on `top` has to be erected
 * that way round, and `bottom` is the default because it is how props are set
 * unless a drawing says otherwise.
 */
export function propCapacityKn(
  prop: PropType,
  lengthM: number,
  orientation: 'bottom' | 'top' = 'bottom',
): number | undefined {
  if (lengthM > prop.maxLengthM + 1e-9) return undefined
  const rows = [...prop.capacities].sort((a, b) => a.lengthM - b.lengthM)
  const at = rows.find((row) => row.lengthM >= lengthM - 1e-9)
  if (!at) return undefined
  const wanted = orientation === 'top' ? at.topKn : at.bottomKn
  // A row that publishes only the other orientation still bounds this one: the
  // figures bracket each other, and the lower of the pair is always the safe read.
  return (
    wanted ??
    Math.min(at.bottomKn ?? Number.POSITIVE_INFINITY, at.topKn ?? Number.POSITIVE_INFINITY)
  )
}
