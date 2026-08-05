import {
  DEFAULT_FALSEWORK_BEAM_ID,
  DEFAULT_PROP_ID,
  DEFAULT_SHEATHING_ID,
  type FalseworkBeamType,
  falseworkBeam,
  type PropType,
  propCapacityKn,
  propType,
  type SheathingType,
  sheathingType,
} from '../catalog'
import {
  type AllowableSpan,
  DEFLECTION_ARCHITECTURAL,
  DEFLECTION_LUMBER,
  DEFLECTION_STRUCTURAL,
  type DeflectionLimit,
  type MemberDesign,
  memberDesign,
  solveSpan,
} from './beam'
import { type VerticalLoad, type VerticalLoadInput, verticalLoad } from './vertical-load'

/**
 * The falsework chain under a soffit: load → sheathing → joists → bearers → props.
 *
 * Each step's output is the next step's input, and the order is not negotiable —
 * the joist spacing *is* the sheathing's allowable span, so solving them
 * independently produces a deck whose members were each checked against a load
 * neither of them carries. design.md §2.1 sets it out as a numbered loop for
 * exactly that reason.
 *
 * Two things make this different from the wall chain. The load is a pressure that
 * does not vary with height, so there is no envelope and no graded spacing — a
 * deck is uniform, which is why a slab's parts list is short and its arithmetic is
 * one pass. And it terminates in a *point* load rather than a spacing: the prop
 * takes the bearer's reaction, and a prop is chosen from a table by extension
 * rather than solved for, so the last step is a check and not a solve.
 *
 * Every calculated span is reported alongside the adopted one. The adopted figure
 * is rounded down onto a module the crew can set out, because a deck marked at
 * 0.4713 m is a deck set out wrong — and the gap between the two is where the
 * spare capacity in a real layout lives.
 *
 * See `wiki/formwork/reference/design.md` §2.1–2.3, §1.7.
 */

/** Setting-out module for a deck, m. Beam and prop centres are marked to 50 mm. */
export const FALSEWORK_MODULE_M = 0.05

/**
 * Widest prop spacing worth emitting whatever the arithmetic allows, m. A deck
 * propped further apart than this is a deck nobody walks under comfortably, and
 * the bearer sizes stop being handleable well before the check fails.
 */
export const MAX_PROP_SPACING_M = 2.0

/** Widest joist spacing on a deck, m. Past this the ply is unsupported rather than lightly loaded. */
export const MAX_JOIST_SPACING_M = 0.6

export type FalseworkWarningKind =
  /** The load needs the members closer than a crew can practically set them. */
  | 'spacing-below-practical-minimum'
  /** No prop in the catalog reaches the soffit height. */
  | 'prop-does-not-reach'
  /** The prop is overloaded even at the tightest spacing offered. */
  | 'prop-over-capacity'
  /** The design values used are not a published product declaration. */
  | 'unverified-sheathing'
  /** A member's published capacity is not a permissible value and was not derated. */
  | 'capacity-basis-mismatch'
  /** A spacing the project stated is wider than the check allows. */
  | 'stated-spacing-over-capacity'

export interface FalseworkWarning {
  kind: FalseworkWarningKind
  message: string
  demandKn?: number
  capacityKn?: number
}

export interface FalseworkDesign {
  load: VerticalLoad
  sheathing: SheathingType | undefined
  /** Secondary beams directly under the deck. */
  joist: MemberDesign
  /** Primary beams carrying the joists to the props. */
  bearer: MemberDesign
  /** Prop centres along each bearer, m. */
  propSpacing: MemberDesign
  /** Load on one prop at the adopted grid, kN. */
  propLoadKn: number
  propCapacityKn: number | undefined
  props: PropType | undefined
  beam: FalseworkBeamType | undefined
  /** Props per m² of soffit at the adopted grid — the falsework density figure. */
  propsPerM2: number
  warnings: FalseworkWarning[]
}

export interface FalseworkOptions extends VerticalLoadInput {
  sheathingId?: string
  beamId?: string
  propId?: string
  /** Soffit height above the floor the deck is propped off, m. */
  soffitHeightM: number
  /** Governs the deflection limit: architectural work takes `l/360` and a 1.6 mm cap. */
  architectural?: boolean
  /**
   * The longest run the deck spans, m. Sets how many spans each member is
   * continuous over — a 2 m bay of deck is not a three-span beam however the
   * coefficients would prefer it.
   */
  runM?: number
  /** Which end the prop's outer tube is at. Not cosmetic: it changes the capacity. */
  propOrientation?: 'bottom' | 'top'
  /** Joist centres the project has fixed, m. Reported against, not used to choose. */
  statedJoistSpacingM?: number
  /** Bearer centres the project has fixed, m. */
  statedBearerSpacingM?: number
}

function design(
  solved: AllowableSpan,
  loadKnM: number,
  maxM: number,
  statedM?: number,
): MemberDesign {
  return memberDesign(solved, loadKnM, { moduleM: FALSEWORK_MODULE_M, maxM, statedM })
}

/**
 * The falsework under one soffit.
 *
 * `runM` defaults to the prop ceiling rather than to something large, because
 * assuming a long run means assuming three-span continuity, and that is the
 * unconservative direction — see `solveSpan`.
 */
export function falseworkDesign(opts: FalseworkOptions): FalseworkDesign {
  const load = verticalLoad(opts)
  const sheathing = sheathingType(opts.sheathingId ?? DEFAULT_SHEATHING_ID)
  const beam = falseworkBeam(opts.beamId ?? DEFAULT_FALSEWORK_BEAM_ID)
  const props = propType(opts.propId ?? DEFAULT_PROP_ID)
  const warnings: FalseworkWarning[] = []

  // The sheathing is what the finish is read off, so its limit follows the surface
  // class: `l/360` plus a 1.6 mm cap for architectural work, `l/270` otherwise.
  // The lumber limit below is not the alternative to the architectural one — it is
  // tighter than `l/270`, so using it here would over-design every ordinary deck
  // and leave `architectural` making no difference to anything.
  const plyLimit: DeflectionLimit = opts.architectural
    ? DEFLECTION_ARCHITECTURAL
    : DEFLECTION_STRUCTURAL
  const runM = opts.runM ?? MAX_PROP_SPACING_M

  if (sheathing && sheathing.verification === 'unverified') {
    warnings.push({
      kind: 'unverified-sheathing',
      message: `${sheathing.label} carries derived design values rather than a manufacturer's declaration, so the joist spacing below is indicative. Enter a Metsä WISA-Form, UPM or Doka datasheet before building to it.`,
    })
  }
  for (const member of [sheathing, beam]) {
    if (member && member.capacityBasis !== 'permissible') {
      warnings.push({
        kind: 'capacity-basis-mismatch',
        message: `${member.label} publishes ${member.capacityBasis} capacities, which are not comparable with the working load used here. Derate them or supply permissible values.`,
      })
    }
  }

  // Step 3–4: the deck spans between joists, so its allowable span *is* the joist
  // spacing. Face grain across the supports — the strong direction, and the one a
  // deck is laid in; the weak direction is 46 % down and is never the intent.
  const joistSolved = sheathing
    ? solveSpan(
        load.totalKpa,
        {
          momentKnM: sheathing.acrossSupports.momentKnMPerM,
          shearKn: sheathing.acrossSupports.shearKnPerM,
          eiKnM2: sheathing.acrossSupports.eiKnM2PerM,
        },
        plyLimit,
        runM,
      )
    : undefined
  const joist = joistSolved
    ? design(joistSolved, load.totalKpa, MAX_JOIST_SPACING_M, opts.statedJoistSpacingM)
    : {
        calculatedM: MAX_JOIST_SPACING_M,
        adoptedM: MAX_JOIST_SPACING_M,
        governedBy: 'bending' as const,
        spans: 3,
        loadKnM: load.totalKpa,
        utilisation: 0,
        cappedBy: 'practical-maximum' as const,
      }

  // Step 5–6: each joist carries the pressure over its own spacing, and how far it
  // spans is the bearer spacing.
  const joistLineKnM = load.totalKpa * joist.adoptedM
  const bearerSolved = beam ? solveSpan(joistLineKnM, beam, DEFLECTION_LUMBER, runM) : undefined
  const bearer = bearerSolved
    ? design(bearerSolved, joistLineKnM, MAX_PROP_SPACING_M, opts.statedBearerSpacingM)
    : {
        calculatedM: MAX_PROP_SPACING_M,
        adoptedM: MAX_PROP_SPACING_M,
        governedBy: 'bending' as const,
        spans: 3,
        loadKnM: joistLineKnM,
        utilisation: 0,
        cappedBy: 'practical-maximum' as const,
      }

  // Step 7–8: the bearer carries the joist reactions over its own spacing, and how
  // far *it* spans is the prop pitch.
  const bearerLineKnM = load.totalKpa * bearer.adoptedM
  const propSolved = beam ? solveSpan(bearerLineKnM, beam, DEFLECTION_LUMBER, runM) : undefined
  const propSpacing = propSolved
    ? design(propSolved, bearerLineKnM, MAX_PROP_SPACING_M)
    : {
        calculatedM: MAX_PROP_SPACING_M,
        adoptedM: MAX_PROP_SPACING_M,
        governedBy: 'bending' as const,
        spans: 3,
        loadKnM: bearerLineKnM,
        utilisation: 0,
        cappedBy: 'practical-maximum' as const,
      }

  // A prop carries the soffit area its grid cell covers. The grid is bearer spacing
  // one way and prop pitch the other, so this is a plain tributary area and not a
  // reaction coefficient — the continuity is already spent on the beams above.
  const cellM2 = bearer.adoptedM * propSpacing.adoptedM
  const propLoadKn = load.totalKpa * cellM2
  // The prop is as long as the soffit is high, less the depth of what it holds up.
  const propLengthM = Math.max(0, opts.soffitHeightM)
  const capacityKn = props
    ? propCapacityKn(props, propLengthM, opts.propOrientation ?? 'bottom')
    : undefined

  if (props && capacityKn === undefined) {
    warnings.push({
      kind: 'prop-does-not-reach',
      message: `${props.label} extends to ${props.maxLengthM} m and this soffit is ${propLengthM.toFixed(2)} m above its support. Use a taller prop or a falsework tower.`,
    })
  } else if (capacityKn !== undefined && propLoadKn > capacityKn + 1e-6) {
    warnings.push({
      kind: 'prop-over-capacity',
      message: `At ${bearer.adoptedM.toFixed(2)} × ${propSpacing.adoptedM.toFixed(2)} m each prop takes ${propLoadKn.toFixed(1)} kN against ${capacityKn.toFixed(1)} kN allowed at ${propLengthM.toFixed(2)} m extension. Close the prop grid or use a heavier prop.`,
      demandKn: propLoadKn,
      capacityKn,
    })
  }

  for (const [label, member] of [
    ['Joists', joist],
    ['Bearers', bearer],
  ] as const) {
    if (member.stated && member.utilisation > 1 + 1e-6) {
      warnings.push({
        kind: 'stated-spacing-over-capacity',
        message: `${label} are stated at ${member.adoptedM.toFixed(3)} m and the check allows ${member.calculatedM.toFixed(3)} m under ${member.loadKnM.toFixed(1)} kN/m, governed by ${member.governedBy}. That is ${Math.round(member.utilisation * 100)} % of capacity. Close the spacing or state a stronger member.`,
      })
    }
  }

  if (joist.adoptedM <= FALSEWORK_MODULE_M + 1e-9) {
    warnings.push({
      kind: 'spacing-below-practical-minimum',
      message: `The deck needs joists at ${joist.calculatedM.toFixed(3)} m under ${load.totalKpa.toFixed(1)} kPa, which is closer than a deck is built. Use thicker sheathing.`,
    })
  }

  return {
    load,
    sheathing,
    joist,
    bearer,
    propSpacing,
    propLoadKn,
    propCapacityKn: capacityKn,
    props,
    beam,
    propsPerM2: cellM2 > 0 ? 1 / cellM2 : 0,
    warnings,
  }
}
