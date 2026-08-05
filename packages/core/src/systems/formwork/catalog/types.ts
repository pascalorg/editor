/**
 * Formwork products, as data. A panel is not a width the layout invents — it is
 * a thing with an item number, a weight, a permissible pressure and tie holes at
 * fixed heights, and picking a size the manufacturer does not sell produces a
 * drawing nobody can build from.
 *
 * Every capacity carries the basis it was published on and a `sourceRef`, and
 * every entry carries `verification`, because much of this had to be read off
 * dealer listings rather than a stamped design table. A number the engine is not
 * sure of still ships — a project needs an answer — but it says so.
 *
 * See `wiki/formwork/reference/products.md` for the transcribed tables.
 */

export type Verification = 'verified' | 'secondary' | 'unverified'

/**
 * Whether a published capacity is already reduced for safety. Mixing the two is
 * how a form gets built at the ultimate load: a permissible value is compared
 * against the working pressure directly, an ultimate one has to be divided down
 * first, and nothing in the number itself says which it is.
 */
export type CapacityBasis = 'permissible' | 'ultimate' | 'design'

export interface CatalogEntry {
  id: string
  manufacturer: string
  systemFamily: string
  label: string
  /** Manufacturer's own item/article number, as printed. */
  itemNo?: string
  weightKg: number
  /**
   * Which published list this was read from. Weights drift between editions and
   * reconditioned stock differs from new — PERI's brochure and its dealer list
   * disagree by 8 % on the same item number — so a weight is only meaningful
   * with the edition attached.
   */
  catalogSource: string
  verification: Verification
}

/**
 * Where a panel's ties can pass through, as distances in mm from the panel's
 * bottom-left corner. Ties are not free to sit where the pressure calculation
 * wants them: the frame is drilled, and every tie has to land in a hole that
 * lines up across adjacent panels.
 */
export interface TieHoleGrid {
  /** Hole heights above the panel's base. */
  levelsMm: readonly number[]
  /**
   * Hole positions across the panel's width. A single centred column on narrow
   * panels, two on the wide ones — which is the whole of the "large panels need
   * only two tie positions" economy claim.
   */
  columnsMm: readonly number[]
  sourceRef: string
}

/**
 * A panel's permissible fresh-concrete pressure. Two numbers because a system is
 * rated one way on a wall and another on a column, and one conditional because
 * Doka uprates Framax from 80 to 100 kN/m² on its narrow panels only — a rating
 * that depends on which panel you picked, not on the system.
 */
export interface PermissiblePressure {
  wallsKnM2: number
  columnsKnM2?: number
  /** Uprated value, and the widths it is allowed on. */
  upratedKnM2?: number
  upratedWidthsMm?: readonly number[]
  /**
   * The pressure code the rating was certified against. A value published
   * against DIN 18218 is not comparable with an ACI 347 envelope, so the check
   * has to know which one produced it.
   */
  pressureStandard: 'DIN 18218:2010' | 'DIN 18218:1980' | 'ACI 347'
  basis: CapacityBasis
  sourceRef: string
}

export interface PanelType extends CatalogEntry {
  widthMm: number
  heightMm: number
  /**
   * Front-to-back depth of the frame. Constant across every panel in a system —
   * 120 mm on all of TRIO — which is what lets panels of different sizes share
   * one waler line and one tie length.
   */
  frameDepthMm: number
  tieHoles: TieHoleGrid
  pressure: PermissiblePressure
  /**
   * A panel a T-junction or a stop-end lands on, rather than a run panel. Doka
   * marks these with blue corners and PERI calls them Multi Panels; they are
   * drilled differently and cost more, so the layout must not spend one where an
   * ordinary panel would do.
   */
  universal?: boolean
  /** Self-compacting concrete variant, with a hose coupler and a closure tool. */
  selfCompacting?: boolean
}

/**
 * How long a corner unit's legs are. Two different worlds:
 *
 * `fixed` — a system corner is a manufactured part, so its legs are what they
 * are (PERI's TE 270-2 is 180 × 300 mm) and a wall of the wrong thickness is
 * absorbed by a compensation plate, not by a different corner.
 *
 * `derived-from-core` — conventional ply-and-timber, cut to fit, where the trade
 * arithmetic applies: the outside leg wraps the core it turns onto, so it is
 * longer than the inside leg by that wall's thickness. Getting this backwards is
 * the classic corner-unit error.
 */
export type CornerLegSpec =
  | { kind: 'fixed'; legAMm: number; legBMm: number }
  | { kind: 'derived-from-core'; insideLegMm: number }

export interface CornerType extends CatalogEntry {
  side: 'inside' | 'outside'
  heightMm: number
  legs: CornerLegSpec
  /**
   * Angles the unit covers. A rigid corner is a single angle; a hinged or
   * articulated one sweeps a range, and a junction outside every range in the
   * system needs a bespoke filler rather than a product.
   */
  angleRangeDeg: { minDeg: number; maxDeg: number }
  hinged?: boolean
}

/**
 * Making up the gap a whole number of panels cannot fill. Systems ship a
 * cascade of these — discrete plates in a few widths, then one continuously
 * adjustable filler, then a profile that holds a site-cut board — and the layout
 * should walk it in order, because each step costs more labour than the last.
 */
export interface FillerType extends CatalogEntry {
  heightMm: number
  /** A plate of one width, or a filler adjustable anywhere in a range. */
  width: { kind: 'fixed'; widthMm: number } | { kind: 'range'; minMm: number; maxMm: number }
  /**
   * `site-cut` means the part is a profile plus a board somebody cuts, so the
   * piece it holds becomes a cut-list line rather than a catalog line.
   */
  madeFrom: 'system-plate' | 'aluminium' | 'timber' | 'site-cut'
}

/**
 * What closes a column box. Nothing passes through a column, so the form is held by
 * clamps that wrap right around the outside and react against each other — which is
 * why a column has no analogue of a wall's tie grid, and why the clamp's own reach
 * is a hard constraint on the cross-section: a section inside the panel's range but
 * outside the clamp's cannot be built at all.
 *
 * Sold in sets of four, one per side, adjusted on a punched pitch. `capacityKn` is
 * per side rather than per set: a clamp spans two opposing faces and the load it
 * takes from each is what its rated figure describes.
 */
export interface ColumnClampType extends CatalogEntry {
  /** Cross-section the clamp reaches, mm. Narrower than the panel range is normal. */
  minSizeMm: number
  maxSizeMm: number
  /** Punched-hole pitch the adjustment steps on, mm. */
  incrementMm: number
  /** Clamps per set — four, one per face, on every product in the trade. */
  setQuantity: number
  /** Rated tension at the clamp's corner connection, kN. */
  capacityKn: number
  /**
   * Bending capacity of the clamp's own arm as a span moment, kN·m.
   *
   * On a box closed by angle clamps the clamp *is* the yoke, and this is what
   * actually sets the spacing. The arm spans the whole side carrying the face load,
   * so its demand goes as `p·s·b²/8` — with `b²` in it — while the corner tension
   * only goes as `p·s·b`. Past a few hundred millimetres of section the bending term
   * arrives first, which is why the classic column-clamp table reads in inches even
   * though the tension figures are tens of kN. A schedule derived from the tension
   * alone comes out several times too wide and looks like it passed.
   */
  bendingMomentKnM: number
  capacityBasis: CapacityBasis
  sourceRef: string
}

/**
 * Column forms size differently from walls, so they cannot share `PanelType`. A
 * wall takes a set of discrete widths; a column box adjusts continuously within
 * a range in fixed increments, and stacks up on a height grid.
 */
export interface ColumnFormType extends CatalogEntry {
  minDimMm: number
  maxDimMm: number
  incrementMm: number
  heightGridMm: number
  maxHeightMm: number
  pressure: PermissiblePressure
  /**
   * The clamps offered with this form, in reach order. A form with none is one whose
   * clamp arrangement is published as part of the panel system rather than as a
   * separate part, and its schedule falls back to the spacing the host names.
   */
  clamps?: readonly ColumnClampType[]
  /**
   * Bending capacity of one yoke as a span moment, kN·m. What caps the spacing on a
   * wide column independently of the clamp's tension rating: the yoke has to carry
   * the face load across the full width of the side, and a long yoke runs out of
   * bending capacity before the clamp runs out of grip.
   */
  yokeMomentKnM?: number
}

/**
 * The clamp in `form` that reaches `dimMm`, smallest reach first. A clamp is
 * selected on the section it has to close, and the shortest one that closes it is
 * both the cheapest and the stiffest — a 450–1200 clamp set to 300 is not merely
 * wasteful, it is at the bottom of its adjustment where its own arm is longest.
 */
export function clampForSizeMm(form: ColumnFormType, dimMm: number): ColumnClampType | undefined {
  return [...(form.clamps ?? [])]
    .filter((clamp) => dimMm >= clamp.minSizeMm && dimMm <= clamp.maxSizeMm)
    .sort((a, b) => a.maxSizeMm - b.maxSizeMm)[0]
}

export interface TieType extends CatalogEntry {
  system: string
  capacityKn: number
  capacityBasis: CapacityBasis
  /**
   * The pieces the load also passes through. These routinely govern before the
   * rod does — a DW 20 rod carrying 150 kN through a bracket rated 15 kN fails
   * at the bracket — so a tie check that only looks at the rod is wrong.
   */
  componentCapacitiesKn?: Readonly<Record<string, number>>
  /** Wall thicknesses the tie reaches, mm. */
  wallRangeMm?: { minMm: number; maxMm: number }
  /** Tied and struck from one face — the only option against earth or rock. */
  oneSided?: boolean
  /** Taper or waterstop variant, for work where a through-hole is not allowed. */
  watertight?: boolean
  sourceRef: string
}

/**
 * The capacity that governs, and the part that sets it. A DW 15 rod rated 20 kN
 * bearing on a bracket rated 15 kN fails at 15, so the rod's own figure is the
 * wrong one to check against — and naming the part is what lets someone swap it.
 */
export function governingCapacity(tie: TieType): { capacityKn: number; component: string } {
  let capacityKn = tie.capacityKn
  let component = tie.label
  for (const [part, rating] of Object.entries(tie.componentCapacitiesKn ?? {})) {
    if (rating < capacityKn) {
      capacityKn = rating
      component = part
    }
  }
  return { capacityKn, component }
}

/**
 * The strongest tie in the system that reaches this wall. A tie with no stated
 * range reaches anything — it is a through-rod cut to length.
 */
export function tieForThickness(
  system: FormworkSystem,
  wallThicknessMm: number,
): TieType | undefined {
  const fits = system.ties.filter(
    (tie) =>
      !tie.wallRangeMm ||
      (wallThicknessMm >= tie.wallRangeMm.minMm && wallThicknessMm <= tie.wallRangeMm.maxMm),
  )
  return fits.sort((a, b) => governingCapacity(b).capacityKn - governingCapacity(a).capacityKn)[0]
}

/**
 * A plywood sheet as bought. Length runs with the face grain, and that is why a
 * 1250 × 2500 sheet is not a 2500 × 1250 one: the panel is far stiffer across
 * the span the grain runs along, so a nesting routine that rotates sheets freely
 * produces a cut list whose pieces are weaker than the ones that were designed.
 */
export interface SheetStock extends CatalogEntry {
  /** Along the face grain, mm. */
  lengthMm: number
  widthMm: number
  thicknessMm: number
  /**
   * Whether the sheet may be rotated 90° when nesting. False for film-faced
   * structural ply, where the grain carries the bending.
   */
  rotatable: boolean
  /**
   * Surface film weight, g/m². The single best predictor of how many pours a
   * sheet survives — plain unfilmed ply gives 3–8, a 220 g hardwood film 10–20,
   * an alkus plastic sheet 100+ — so reuse is derived from this rather than
   * guessed per project.
   */
  filmWeightGm2?: number
  /** Pours before replacement, from the film weight. */
  expectedReuses: { min: number; max: number }
  sourceRef: string
}

/**
 * One manufacturer's system as the layout sees it: the panels it may pick from,
 * the corners it may turn on, and the cascade it makes up the remainder with.
 */
export interface FormworkSystem {
  id: string
  manufacturer: string
  label: string
  /** Constant frame depth, repeated here so a layout can read it without a panel. */
  frameDepthMm: number
  panels: readonly PanelType[]
  corners: readonly CornerType[]
  fillers: readonly FillerType[]
  ties: readonly TieType[]
  /**
   * Practical cap on tie spacing whatever the calculation allows, mm. Around
   * 900 mm is the common site limit; a system whose holes are further apart than
   * this is telling you its panels are stiffer, not that the crew will like it.
   */
  maxPracticalTieSpacingMm: number
  verification: Verification
  sourceRef: string
}

/** Every distinct panel width in a system, ascending — the layout's alphabet. */
export function panelWidthsMm(system: FormworkSystem): number[] {
  return [...new Set(system.panels.map((panel) => panel.widthMm))].sort((a, b) => a - b)
}

/** Every distinct panel height in a system, ascending. */
export function panelHeightsMm(system: FormworkSystem): number[] {
  return [...new Set(system.panels.map((panel) => panel.heightMm))].sort((a, b) => a - b)
}

/**
 * The pressure a panel may actually be worked to. The uprated rating applies
 * only to the widths it was published for, so it is read off the panel rather
 * than the system.
 */
export function permissiblePressureKnM2(panel: PanelType, kind: 'wall' | 'column'): number {
  const { pressure } = panel
  if (kind === 'column') return pressure.columnsKnM2 ?? pressure.wallsKnM2
  if (pressure.upratedKnM2 && pressure.upratedWidthsMm?.includes(panel.widthMm)) {
    return pressure.upratedKnM2
  }
  return pressure.wallsKnM2
}

/**
 * How long each leg of a corner unit is, mm. `turnsOntoCoreMm` is the thickness
 * of the wall the leg turns onto — the neighbour's, not its own — and is only
 * consulted for a cut-to-fit corner.
 */
export function cornerLegsMm(
  corner: CornerType,
  turnsOntoCoreMm: number,
): { legAMm: number; legBMm: number } {
  if (corner.legs.kind === 'fixed') {
    return { legAMm: corner.legs.legAMm, legBMm: corner.legs.legBMm }
  }
  const inside = corner.legs.insideLegMm
  const leg = corner.side === 'inside' ? inside : inside + turnsOntoCoreMm
  return { legAMm: leg, legBMm: leg }
}

/** Whether a system has a corner unit that covers this junction angle. */
export function cornerForAngle(
  system: FormworkSystem,
  side: 'inside' | 'outside',
  angleDeg: number,
  heightMm?: number,
): CornerType | undefined {
  const candidates = system.corners.filter(
    (corner) =>
      corner.side === side &&
      angleDeg >= corner.angleRangeDeg.minDeg &&
      angleDeg <= corner.angleRangeDeg.maxDeg &&
      (heightMm === undefined || corner.heightMm === heightMm),
  )
  // A rigid corner before a hinged one: both fit a right angle, and the hinged
  // unit is heavier and dearer because it can also do the angles the rigid one
  // cannot.
  return candidates.sort((a, b) => Number(a.hinged ?? false) - Number(b.hinged ?? false))[0]
}

/**
 * The cheapest way to make up `gapMm`, walking the system's cascade. Returns
 * undefined when the gap is below every filler's reach, which is not a failure
 * to report but a signal to the layout to drop a panel and re-split the run —
 * two workable pieces beat one panel and a sliver nothing fills.
 *
 * `heightMm` matters as much as the width: fillers are made in the panel heights,
 * and a 1.20 m plate does not close a 2.70 m run however well its width fits. Left
 * out, the lightest match wins, which is always the shortest one.
 */
export function fillerForGap(
  system: FormworkSystem,
  gapMm: number,
  heightMm?: number,
): FillerType | undefined {
  const fitsWidth = (filler: FillerType) =>
    filler.width.kind === 'fixed'
      ? filler.width.widthMm === gapMm
      : gapMm >= filler.width.minMm && gapMm <= filler.width.maxMm
  const order: FillerType['madeFrom'][] = ['system-plate', 'aluminium', 'timber', 'site-cut']
  const candidates = system.fillers.filter(
    (filler) => fitsWidth(filler) && (heightMm === undefined || filler.heightMm === heightMm),
  )
  return candidates.sort(
    (a, b) => order.indexOf(a.madeFrom) - order.indexOf(b.madeFrom) || a.weightKg - b.weightKg,
  )[0]
}
