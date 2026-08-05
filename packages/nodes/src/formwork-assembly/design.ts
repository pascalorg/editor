import {
  type ClampSchedule,
  COLUMN_FORMS,
  type ColumnFormType,
  clampSchedule,
  columnFormSizeMm,
  type FalseworkDesign,
  type FormworkSystem,
  falseworkDesign,
  type PourUnit,
  type PressureEnvelope,
  pressureAtDepth,
  type WallDesign,
  wallDesign,
} from '@pascal-app/core/formwork'
import type { ColumnNode, SlabNode, WallNode } from '@pascal-app/core/schema'
import { assemblySystem, COLUMN_KICKER_M, designEnvelope } from './geometry-shared'

/**
 * The structural design of one pour, solved from the element and its pour unit
 * alone.
 *
 * It lives apart from the geometry builders because two surfaces need the same
 * answer and only one of them has a `GeometryContext`. The builders place what the
 * chain returns; the inspector's design report prints it. Solving it twice — once
 * per surface, off two argument lists — is how a drawing and a panel come to
 * disagree about the tie spacing of the same wall, so there is one function per
 * kind and both callers use it.
 *
 * Everything here is derived from the host node and the `PourUnit`, and nothing
 * from the scene graph, so the report does not need to resolve neighbours to
 * repeat the design. Which *faces* are formed does need the neighbours, and that
 * stays in `resolveFormworkScope`.
 */

/** Facets each cross-section is shuttered with. A tube reads as many short arcs. */
const SHAFT_FACETS: Partial<Record<ColumnNode['crossSection'], number>> = {
  round: 24,
  octagonal: 8,
  'sixteen-sided': 16,
}

/**
 * Storey height assumed when the slab does not say how far its soffit stands above
 * the floor it is propped off, m. Only reached when `soffitHeightAboveSupport` is
 * absent and the slab sits at or below the level plane, where `elevation` alone
 * gives no usable prop length.
 */
const NOMINAL_STOREY_M = 2.4

/**
 * The form this section is boxed in. The dedicated column form comes first and
 * the panel arrangement second, so a section inside both is formed by the part
 * made for it; a section only the wider-reaching arrangement takes gets that.
 * Neither reaching means a bespoke box, and the schedule says so rather than
 * being derived against a clamp that cannot close.
 */
function columnForm(sideMm: number, heightMm: number): ColumnFormType | undefined {
  const reaching = COLUMN_FORMS.filter((form) => columnFormSizeMm(form, sideMm) !== undefined)
  return reaching.find((form) => heightMm <= form.maxHeightMm) ?? reaching[0]
}

export interface WallPourDesign {
  design: WallDesign
  /** The catalog system the panels come from, resolved once for the layout and the design. */
  system: FormworkSystem | undefined
  /** The concrete's own height in this pour, m — the head the chain was solved on. */
  liftHeightM: number
}

/**
 * The lateral chain for one wall pour.
 *
 * Solved on the concrete's own height rather than the form's: the form stands proud
 * of the pour by its freeboard, and freeboard carries no head. The run is the
 * stretch of *this pour unit* the walers are continuous over, not the whole wall —
 * a bay cut short by a joint has fewer spans and so a shorter allowable one.
 */
export function wallPourDesign(
  wall: WallNode,
  unit: PourUnit | undefined,
  systemId: string | undefined,
): WallPourDesign {
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const thickness = wall.thickness ?? 0.15
  const baseY = unit?.baseElevation ?? 0
  const topY = unit?.topElevation ?? wall.height ?? 2.4
  const spanStart = unit?.startAlong ?? 0
  const spanEnd = unit?.endAlong ?? wallLength
  const system = assemblySystem(systemId)
  const liftHeightM = topY - baseY
  return {
    system,
    liftHeightM,
    design: wallDesign({
      envelope: designEnvelope(liftHeightM, [wallLength, thickness]),
      liftHeightM,
      runM: spanEnd - spanStart,
      wallThicknessMm: thickness * 1000,
      system,
      // Visible concrete is read for its finish, so the sheathing takes the tighter
      // `l/360` plus absolute cap rather than general structural `l/270`.
      architectural: wall.exposureClass === 'architectural',
      // Spacings the job has fixed are honoured; the design then reports against them,
      // so an overload shows up in the warnings rather than being silently retightened
      // under a crew that has already set out to the stated module.
      statedWalerSpacingM: wall.walerSpacing,
      statedTieSpacingM: wall.tieSpacing,
    }),
  }
}

export interface ColumnPourDesign {
  schedule: ClampSchedule
  form: ColumnFormType | undefined
  /** Facets a wrapped shaft is banded with, or `undefined` where the section is boxed. */
  facets: number | undefined
  /** Widest plan dimension of the concrete, m — the side a yoke spans. */
  sideM: number
  liftHeightM: number
  /** Kicker at the base of this pour, m. Zero at a lift joint. */
  kickerM: number
  envelope: PressureEnvelope
  /**
   * Pressure at the base of the pour, kN/m². The schedule grades every row off the
   * envelope rather than sizing on one figure, so this is the worst row's, and it is
   * reported so a column's head can be compared with the wall beside it.
   */
  designPressureKnM2: number
}

/**
 * The clamp schedule for one column pour, plus the form it is set in.
 *
 * A column is filled in one continuous operation, so the fastest rate the code
 * covers is also the honest one — ACI directs the full fluid head for columns
 * anyway (design.md §2.7 step 1).
 */
export function columnPourDesign(column: ColumnNode, unit: PourUnit | undefined): ColumnPourDesign {
  const baseY = unit?.baseElevation ?? 0
  const topY = unit?.topElevation ?? column.height
  // A column is formed right up to the soffit above it, so there is no margin at the
  // top — only at the base, where the form lands on the kicker cast to locate it. At
  // a lift joint there is no kicker: the concrete below is this same column.
  const kickerM = baseY <= 1e-6 && column.kickerMode !== 'kickerless' ? COLUMN_KICKER_M : 0
  const facets = SHAFT_FACETS[column.crossSection]
  const planDimensionsM =
    facets !== undefined ? [column.radius * 2, column.radius * 2] : [column.width, column.depth]
  const sideM = Math.max(...planDimensionsM)
  const liftHeightM = topY - baseY
  // A wrapped shaft is banded in hoop tension rather than closed by a clamp set,
  // and no form or band in the catalog answers for one — so it is scheduled off
  // the pressure and the practical limits alone.
  const form = facets !== undefined ? undefined : columnForm(sideM * 1000, liftHeightM * 1000)
  const envelope = designEnvelope(liftHeightM, planDimensionsM)
  return {
    facets,
    form,
    sideM,
    liftHeightM,
    kickerM,
    envelope,
    designPressureKnM2: pressureAtDepth(envelope, liftHeightM),
    schedule: clampSchedule({
      liftHeightM,
      sideM,
      kickerM,
      envelope,
      form,
      // A spacing the job has stated is used as given. The pressure is then reported
      // against it rather than used to choose it, and an overload it causes is a
      // warning on the schedule rather than a silently retightened row.
      uniformSpacingM: column.tieSpacing,
    }),
  }
}

export interface SlabPourDesign {
  design: FalseworkDesign
  /** How far the soffit stands above the floor the deck is propped off, m. */
  soffitHeightM: number
}

/**
 * The falsework under one slab soffit.
 *
 * A slab takes no pour unit here: the deck is loaded downwards by the concrete's
 * own weight, which is a function of thickness alone, so a slab cast in bays has
 * the same falsework in every one of them.
 */
export function slabPourDesign(slab: SlabNode): SlabPourDesign {
  // The prop reaches from the floor below to the underside of the bearers, so it is
  // the height the falsework is designed at as well as the length drawn.
  const soffitHeightM =
    slab.soffitHeightAboveSupport ?? Math.max(0.5, slab.elevation + NOMINAL_STOREY_M)
  return {
    soffitHeightM,
    design: falseworkDesign({
      slabThicknessM: slab.thickness,
      soffitHeightM,
      // A visible soffit is read for its finish, so it takes the tighter `l/360`
      // plus absolute cap rather than general structural `l/270`.
      architectural: slab.exposureClass === 'architectural',
      // Spacings the job has fixed are honoured; the design then reports against
      // them, so an overload shows up on the schedule rather than being retightened
      // under a crew that has already set out to the stated module.
      statedJoistSpacingM: slab.walerSpacing,
      statedBearerSpacingM: slab.tieSpacing,
    }),
  }
}
