import type { FormworkPartOverride } from '../../schema/nodes/formwork-assembly'
import type { FaceRole } from './coverage/types'

/**
 * What a shutter is made of, part by part.
 *
 * A part is a *result*, not stored state. Nothing here is persisted: the list is
 * derived from the same solve and the same layout the geometry is built from, and
 * recomputed whenever they change — exactly like the spacings in `design/`. Only
 * `partOverrides` on the assembly survives a session, keyed by mark. Storing the
 * parts instead would mean a 20-wall floor carrying five thousand entries in the
 * scene, five thousand registry registrations and five thousand outliner rows, and
 * a full store churn plus a history entry every time somebody drags a wall.
 *
 * ## Marks are positions, not counters
 *
 * A mark goes on a drawing that is printed, issued and taken to site. So it has to
 * be the same mark tomorrow: if re-solving the scene renumbers the panels, the
 * override the engineer wrote against `P-A-1-03` lands on a different panel and the
 * drawing in the foreman's hand names something that no longer exists.
 *
 * That rules out a counter. Numbering pieces 1, 2, 3 along a run is stable only
 * until a corner unit appears upstream of them, after which every mark on the run
 * shifts by one — the same failure `partOverrides`' schema comment describes for
 * array indices, arriving through a different door. So the numeric part of a mark
 * is the part's own *position*: `P-A-1-1250` is the panel on face A, course 1, whose
 * near edge is 1250 mm along the run. Insert a panel before it and it is still at
 * 1250. Move the wall and it moves with the wall, which is the one case where a
 * remark is correct.
 *
 * Positions are rounded to the millimetre — finer than any setting-out tolerance,
 * and coarse enough that a float that comes back as 1249.9999999 marks the same.
 *
 * ## Provenance is per part, not per type
 *
 * Two panels of the same catalog id are not interchangeable once one of them has
 * been drilled for a cast-in item or cut down to close a stub: it is off the general
 * pool, its remaining reuses belong to that panel rather than to the type, and it
 * must not be billed on the same line as untouched stock. That is `provenance`, and
 * why `bomLines` splits on it.
 *
 * See `wiki/formwork/reference/products.md` for the catalog side and `design/` for
 * where `utilisation` and `governingCheck` come from — this module invents no
 * engineering numbers of its own, it carries the solvers'.
 */

export type FormworkPartKind =
  | 'panel'
  | 'filler'
  | 'corner'
  | 'stop-end'
  | 'waler'
  | 'joist'
  | 'tie'
  | 'ply-piece'
  | 'prop'
  | 'brace'
  | 'accessory'
  | 'consumable'

/**
 * Where a part came from, which decides whether it can go back on the rack.
 *
 * `modified` is the one that costs money quietly: a standard panel that has been
 * drilled, packed or trimmed for this pour. It is still the catalog item on the
 * delivery note and no longer the catalog item in the yard.
 */
export type PartProvenance =
  /** Catalog stock, used as supplied. */
  | 'standard'
  /** Catalog stock altered for this pour — drilled, trimmed, packed. */
  | 'modified'
  /** Made for this pour: a cut board, a carpenter's box, a fabricated closure. */
  | 'bespoke'

/** What a structural part carries and what stopped it carrying more. */
export interface PartStructure {
  /** How hard the part works at the adopted spacing, 1.0 being at capacity. */
  utilisation: number
  /** The check that governed — a `SpanGoverning`, a `ClampGoverning`, a tie component. */
  governingCheck: string
}

/**
 * Where a part sits, in the terms its own kind is set out in.
 *
 * This is the mark's raw material and the parts table's sort key, which is why it is
 * one shape rather than loose fields per kind: a panel is placed along a run, a prop
 * on a grid, a waler at an elevation, and a box-out inside an opening. Nothing here
 * is a screen coordinate — these are the setting-out figures a crew works to.
 */
export type PartLocus =
  /** Along a formed run: `stationMm` is distance from the run's start. */
  | {
      on: 'run'
      face: FaceRole
      stationMm: number
      /** 0-based course up the lift; the mark prints it 1-based. */
      courseIndex?: number
      /**
       * Elevation above the pour base, mm, where the course is not enough to place
       * the part. A course crossed by a window is formed by two boards at the same
       * station — one under the sill, one over the head — and without this they are
       * the same mark.
       */
      elevationMm?: number
      /**
       * Which way the part runs from its station. Only a corner needs it, and needs
       * it badly: the spine of a T carries two units at the same point on the same
       * face running opposite ways, and without this they mark identically.
       */
      towardEnd?: boolean
    }
  /** On a wrapped shaft, at `angleDeg` around it — the only position a facet has. */
  | { on: 'facet'; face: FaceRole; angleDeg: number; courseIndex?: number }
  /** On a plan grid — props and deck sheets, set out from the slab's own bounds. */
  | { on: 'grid'; xMm: number; zMm: number }
  /** At a height: walers, clamps, tie rows. `stationMm` separates two on one line. */
  | { on: 'elevation'; face?: FaceRole; elevationMm: number; stationMm?: number }
  /** Inside an opening — the returned reveal faces of a box-out. */
  | { on: 'opening'; openingId: string; reveal: string }
  /** Closing an end of the pour. */
  | { on: 'end'; end: 'start' | 'end' | 'edge' }
  /** Not placed: hardware and consumables, counted against the whole assembly. */
  | { on: 'item'; use: string }

interface PartCommon {
  locus: PartLocus
  /** Catalog id where the part is a bought item. Absent for anything made on site. */
  catalogId?: string
  /** What it is called on a bill — the catalog label, or a description of the cut. */
  description: string
  provenance: PartProvenance
  weightKg?: number
  structure?: PartStructure
  /** Set by an override: kept in the list rather than dropped, so the table can show it struck out. */
  omitted?: true
  note?: string
}

/**
 * One part of a shutter, before it has a mark. Callers build these and `partMark`
 * turns them into `FormworkPart`s, so a mark is never hand-written and never
 * disagrees with the position it claims to encode.
 */
export type FormworkPartSpec = PartCommon &
  (
    | {
        kind: 'panel'
        widthMm: number
        heightMm: number
        frameDepthMm?: number
        /** Drilled tie holes this panel brings, if the catalog states them. */
        tieHoleCount?: number
      }
    | {
        kind: 'filler'
        widthMm: number
        heightMm: number
        madeFrom: 'system-plate' | 'aluminium' | 'timber' | 'site-cut'
      }
    | {
        kind: 'corner'
        side: 'inside' | 'outside'
        heightMm: number
        /** Both legs, in the junction corner's own leg order. */
        legLengthsMm: [number, number]
        /**
         * Whether this assembly bills the unit. Both walls at a junction draw a leg
         * and only one buys it — `ElementCorner.owns` decides which, and a BOM that
         * ignores this orders every corner in the building twice.
         */
        owned: boolean
      }
    | {
        kind: 'stop-end'
        areaSqM: number
        /**
         * Starter bars cross this bulkhead. Not a count — nothing in the scene knows
         * how many bars — but the fact matters on its own: a penetrated bulkhead is
         * drilled and sealed rather than simply cut, and that is where its cost is.
         */
        starterPenetrations?: true
      }
    | {
        kind: 'waler'
        /** A wall's waling beam, a column's yoke, or a band round a wrapped shaft. */
        member: 'waler' | 'clamp' | 'band'
        lengthMm: number
      }
    | { kind: 'joist'; member: 'joist' | 'bearer'; lengthMm: number }
    | {
        kind: 'tie'
        /** Wall thickness plus both skins — what has to be ordered, not the wall. */
        lengthMm: number
        forceKn: number
        capacityKn: number
        /** The rod, or the bracket it bears on — whichever ran out first. */
        capacityComponent: string
      }
    | {
        kind: 'ply-piece'
        /** A board cut to close a run, a box-out reveal, or a deck sheet. */
        use: 'cut-board' | 'box-out' | 'deck-sheet'
        widthMm: number
        heightMm: number
      }
    | { kind: 'prop'; extendedLengthMm: number; loadKn: number; capacityKn: number }
    | { kind: 'brace'; lengthMm: number; forceKn: number; anchorUpliftKn: number }
    | { kind: 'accessory'; quantity: number }
    | {
        kind: 'consumable'
        quantity: number
        unit: 'L' | 'm' | 'm2' | 'no'
      }
  )

export type FormworkPart = FormworkPartSpec & { mark: string }

export const PART_KIND_LABELS: Record<FormworkPartKind, string> = {
  panel: 'Panel',
  filler: 'Filler',
  corner: 'Corner unit',
  'stop-end': 'Stop-end',
  waler: 'Waler',
  joist: 'Joist',
  tie: 'Tie',
  'ply-piece': 'Ply piece',
  prop: 'Prop',
  brace: 'Brace',
  accessory: 'Accessory',
  consumable: 'Consumable',
}

/**
 * What a part is called, refined by the member it actually is.
 *
 * `PART_KIND_LABELS` is per kind, and three kinds carry more than one product: a
 * column clamp is not a waler, a bearer is not a joist, and a deck sheet is not a
 * board somebody cut to close a run. Labelling by kind alone puts a name on a drawing
 * the crew would query, and puts two different products under one heading on a bill.
 */
export function partLabel(part: FormworkPartSpec): string {
  switch (part.kind) {
    case 'waler':
      return part.member === 'clamp' ? 'Clamp' : part.member === 'band' ? 'Band' : 'Waler'
    case 'joist':
      return part.member === 'bearer' ? 'Bearer' : 'Joist'
    case 'ply-piece':
      return part.use === 'box-out'
        ? 'Box-out'
        : part.use === 'deck-sheet'
          ? 'Deck sheet'
          : 'Cut board'
    default:
      return PART_KIND_LABELS[part.kind]
  }
}

/** Bill order: the shutter face first, then what backs it, then what holds it up. */
export const KIND_ORDER: readonly FormworkPartKind[] = [
  'panel',
  'filler',
  'corner',
  'stop-end',
  'ply-piece',
  'waler',
  'joist',
  'tie',
  'prop',
  'brace',
  'accessory',
  'consumable',
]

/**
 * Face tokens for marks. Short because a mark is hand-written on a panel with a
 * paint pen, and unambiguous because `A` and `B` are what the drawings already call
 * the two faces of a wall.
 */
const FACE_TOKENS: Record<FaceRole, string> = {
  'side-a': 'A',
  'side-b': 'B',
  'end-start': 'ES',
  'end-end': 'EE',
  top: 'TP',
  bottom: 'BM',
  'column-face-1': 'C1',
  'column-face-2': 'C2',
  'column-face-3': 'C3',
  'column-face-4': 'C4',
  shaft: 'SH',
  soffit: 'SF',
  edge: 'ED',
}

/**
 * A millimetre figure as a mark token, signed with `N` rather than `-` because a
 * minus sign inside a hyphen-joined mark cannot be read back.
 *
 * Padded to five digits so marks sort as strings in the order the parts stand in —
 * four would put `P-A-1-11250` before `P-A-1-1800` on any run over ten metres, which
 * is an ordinary wall. Five covers a hundred metres, and station and elevation are
 * both measured within one pour unit rather than from the level's origin, so neither
 * approaches it. A `grid` locus is in level coordinates and could in principle exceed
 * it on a very large site; the mark stays unique and stable there, only the string
 * ordering degrades, which is cosmetic where identity is not.
 */
function mm(value: number): string {
  const rounded = Math.round(value)
  const digits = Math.abs(rounded).toString().padStart(5, '0')
  return rounded < 0 ? `N${digits}` : digits
}

/** Tenths of a degree, which is finer than any form is set and keeps facets apart. */
function deg(value: number): string {
  const normalised = ((value % 360) + 360) % 360
  return Math.round(normalised * 10)
    .toString()
    .padStart(4, '0')
}

function course(index: number | undefined): string[] {
  return index === undefined ? [] : [String(index + 1)]
}

/** The token that says which way a corner unit runs from its station. */
function direction(towardEnd: boolean | undefined): string[] {
  return towardEnd === undefined ? [] : [towardEnd ? 'F' : 'R']
}

function locusTokens(locus: PartLocus): string[] {
  switch (locus.on) {
    case 'run':
      return [
        FACE_TOKENS[locus.face],
        ...course(locus.courseIndex),
        mm(locus.stationMm),
        ...(locus.elevationMm === undefined ? [] : [mm(locus.elevationMm)]),
        ...direction(locus.towardEnd),
      ]
    case 'facet':
      return [FACE_TOKENS[locus.face], ...course(locus.courseIndex), deg(locus.angleDeg)]
    case 'grid':
      return [mm(locus.xMm), mm(locus.zMm)]
    case 'elevation':
      return [
        ...(locus.face ? [FACE_TOKENS[locus.face]] : []),
        mm(locus.elevationMm),
        ...(locus.stationMm === undefined ? [] : [mm(locus.stationMm)]),
      ]
    case 'opening':
      return [locus.openingId, locus.reveal]
    case 'end':
      return [locus.end]
    case 'item':
      return [locus.use]
  }
}

/** The prefix, which carries what the part *is* — the other half of "kind + position". */
function prefixOf(spec: FormworkPartSpec): string {
  switch (spec.kind) {
    case 'panel':
      return 'P'
    case 'filler':
      return 'F'
    case 'corner':
      return spec.side === 'inside' ? 'CI' : 'CO'
    case 'stop-end':
      return 'SE'
    case 'waler':
      return spec.member === 'waler' ? 'W' : spec.member === 'clamp' ? 'CL' : 'BD'
    case 'joist':
      return spec.member === 'joist' ? 'J' : 'BR'
    case 'tie':
      return 'T'
    case 'ply-piece':
      return spec.use === 'box-out' ? 'BO' : spec.use === 'deck-sheet' ? 'DK' : 'C'
    case 'prop':
      return 'PR'
    case 'brace':
      return 'B'
    case 'accessory':
      return 'AC'
    case 'consumable':
      return 'CS'
  }
}

/**
 * The mark for one part: what it is, then where it is. A pure function of the spec,
 * which is the whole point — two solves of the same shutter produce the same marks
 * because there is nothing else for the mark to depend on.
 */
export function partMark(spec: FormworkPartSpec): string {
  return [prefixOf(spec), ...locusTokens(spec.locus)].join('-')
}

/**
 * Marks appearing more than once.
 *
 * The grammar is meant to be collision-free — every kind's mark carries enough of
 * its position to tell it from its neighbours — so a duplicate means the enumeration
 * placed two parts in one spot, which is a clash rather than a naming problem. Both
 * are kept and marked identically rather than silently suffixed: a suffix would
 * depend on iteration order, which is the property this module exists to avoid, and
 * would hide the clash from the validator whose job it is to find it. This is what
 * finds it.
 */
export function duplicateMarks(parts: readonly FormworkPart[]): string[] {
  const counts = new Map<string, number>()
  for (const part of parts) counts.set(part.mark, (counts.get(part.mark) ?? 0) + 1)
  return [...counts.entries()].filter(([, count]) => count > 1).map(([mark]) => mark)
}

/** How many of a thing one part is. Only hardware and consumables come in quantities. */
export function partQuantity(part: FormworkPart): number {
  return part.kind === 'accessory' || part.kind === 'consumable' ? part.quantity : 1
}

/**
 * Applies the assembly's per-part edits.
 *
 * A part whose catalog id was changed becomes `modified`, not `standard`: the
 * substitution is a decision somebody made about this pour, and a BOM that folds it
 * back into general stock loses the only record of it. An omitted part stays in the
 * list flagged rather than being removed, so the parts table can show what was taken
 * out — a part that vanishes reads as a solver bug rather than as somebody's choice.
 *
 * Overrides naming marks the solve no longer produces are ignored here and reported
 * by `orphanedOverrides`, because a wall that shrinks below a panel is a common,
 * recoverable state and dropping the override on the floor makes it unrecoverable.
 */
export function applyPartOverrides(
  parts: readonly FormworkPart[],
  overrides: Readonly<Record<string, FormworkPartOverride>> | undefined,
): FormworkPart[] {
  if (!overrides) return [...parts]
  return parts.map((part) => {
    const override = overrides[part.mark]
    if (!override) return part
    const substituted =
      override.catalogId !== undefined && override.catalogId !== part.catalogId
        ? { catalogId: override.catalogId, provenance: 'modified' as PartProvenance }
        : {}
    return {
      ...part,
      ...substituted,
      ...(override.omitted ? { omitted: true as const } : {}),
      ...(override.note ? { note: override.note } : {}),
    }
  })
}

/**
 * Merge one part's edit into the assembly's override record.
 *
 * Pure and here rather than in the panel because two write paths need the same
 * answer: the inspector edits the live store while the chat tool edits a plain
 * `SceneGraph` on the server, and `mergeFormworkSettingsGroup` exists for exactly
 * this reason one level up. A disagreement between them about what "not overridden"
 * means is a disagreement about whether a part is standard stock or `modified`.
 *
 * `undefined` in the patch clears the field, and an override that empties is deleted
 * rather than left as `{}` — an empty override is `orphanedOverrides` fodder for the
 * rest of the project's life, reported as a stale edit against a part nobody edited.
 */
export function mergeFormworkPartOverride(
  overrides: Readonly<Record<string, FormworkPartOverride>> | undefined,
  mark: string,
  patch: Partial<FormworkPartOverride>,
): Record<string, FormworkPartOverride> {
  const out: Record<string, FormworkPartOverride> = { ...(overrides ?? {}) }
  const merged: Record<string, unknown> = { ...(out[mark] ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === false || value === '') delete merged[key]
    else merged[key] = value
  }
  if (Object.keys(merged).length === 0) delete out[mark]
  else out[mark] = merged as FormworkPartOverride
  return out
}

/** Overrides whose mark no longer exists, so a stale edit is visible instead of silent. */
export function orphanedOverrides(
  parts: readonly FormworkPart[],
  overrides: Readonly<Record<string, FormworkPartOverride>> | undefined,
): string[] {
  if (!overrides) return []
  const present = new Set(parts.map((part) => part.mark))
  return Object.keys(overrides).filter((mark) => !present.has(mark))
}

/**
 * Drops the named overrides — how a stale edit is discarded once somebody has read it.
 *
 * Deliberately not automatic. A wall shortened below a panel and then lengthened
 * again should get its overrides back, so the orphan is reported and left in place
 * until a person or the model decides it is genuinely finished with.
 */
export function withoutPartOverrides(
  overrides: Readonly<Record<string, FormworkPartOverride>> | undefined,
  marks: readonly string[],
): Record<string, FormworkPartOverride> {
  const out: Record<string, FormworkPartOverride> = { ...(overrides ?? {}) }
  for (const mark of marks) delete out[mark]
  return out
}

/** One line of a bill of materials: a countable thing, and which parts make it up. */
export interface BomLine {
  kind: FormworkPartKind
  catalogId?: string
  description: string
  provenance: PartProvenance
  quantity: number
  unit: string
  /** Absent where any part in the line has no stated weight — a partial total misleads. */
  totalWeightKg?: number
  /** The marks this line covers, so a quantity can be traced back to the drawing. */
  marks: string[]
}

function unitOf(part: FormworkPart): string {
  return part.kind === 'consumable' ? part.unit : 'no'
}

/**
 * The bill: parts grouped into orderable lines.
 *
 * Grouped on provenance as well as on catalog id, because a drilled panel and an
 * untouched one of the same type are two different things to a yard — one goes back
 * on the rack and one follows this job. Grouped on the description too, so two
 * site-cut boards of different sizes stay on separate lines instead of becoming
 * "6 boards" of no stated size.
 *
 * Omitted parts are left out of the quantities and out of the marks: the line is
 * what gets ordered, and the parts table is where an omission is shown.
 *
 * A corner leg that does not own its unit is left out too: both walls at a junction
 * draw a leg, but exactly one of them bills the corner, so a bill that counted both
 * would order every corner in the building twice. The shared leg is still in the
 * parts table — the hardware really is on both faces — it just is not ordered again.
 */
export function bomLines(parts: readonly FormworkPart[]): BomLine[] {
  interface Accumulator {
    line: BomLine
    weightKg: number
    /** False as soon as one part in the line has no stated weight, which voids the total. */
    weighable: boolean
  }
  const lines = new Map<string, Accumulator>()
  for (const part of parts) {
    if (part.omitted) continue
    if (part.kind === 'corner' && !part.owned) continue
    const unit = unitOf(part)
    const key = [part.kind, part.catalogId ?? '', part.description, part.provenance, unit].join(' ')
    let entry = lines.get(key)
    if (!entry) {
      entry = {
        line: {
          kind: part.kind,
          ...(part.catalogId === undefined ? {} : { catalogId: part.catalogId }),
          description: part.description,
          provenance: part.provenance,
          quantity: 0,
          unit,
          marks: [],
        },
        weightKg: 0,
        weighable: true,
      }
      lines.set(key, entry)
    }
    const quantity = partQuantity(part)
    entry.line.quantity += quantity
    entry.line.marks.push(part.mark)
    if (part.weightKg === undefined) entry.weighable = false
    else entry.weightKg += part.weightKg * quantity
  }
  return [...lines.values()]
    .map(({ line, weightKg, weighable }) =>
      weighable ? { ...line, totalWeightKg: weightKg } : line,
    )
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.description.localeCompare(b.description) ||
        a.provenance.localeCompare(b.provenance),
    )
}

/** Total weight of what is being ordered, kg, and whether every part contributed to it. */
export function bomWeightKg(lines: readonly BomLine[]): { totalKg: number; complete: boolean } {
  let totalKg = 0
  let complete = true
  for (const line of lines) {
    if (line.totalWeightKg === undefined) complete = false
    else totalKg += line.totalWeightKg
  }
  return { totalKg, complete }
}

/** The hardest-working part, which is the one number a summary should lead with. */
export function worstUtilisation(
  parts: readonly FormworkPart[],
): { part: FormworkPart; utilisation: number } | undefined {
  let worst: { part: FormworkPart; utilisation: number } | undefined
  for (const part of parts) {
    const utilisation = part.structure?.utilisation
    if (utilisation === undefined || part.omitted) continue
    if (!worst || utilisation > worst.utilisation) worst = { part, utilisation }
  }
  return worst
}

/** Parts working beyond capacity — what a validator reports and a panel colours red. */
export function overUtilisedParts(parts: readonly FormworkPart[]): FormworkPart[] {
  return parts.filter((part) => !part.omitted && (part.structure?.utilisation ?? 0) > 1)
}

/** Finds a part by its mark — the inspector's lookup, and the selection's. */
export function partByMark(
  parts: readonly FormworkPart[],
  mark: string | undefined,
): FormworkPart | undefined {
  return mark === undefined ? undefined : parts.find((part) => part.mark === mark)
}
