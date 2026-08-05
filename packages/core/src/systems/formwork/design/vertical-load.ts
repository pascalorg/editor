import { DEFAULT_UNIT_WEIGHT_KN_M3 } from '../pressure'

/**
 * What a soffit carries, kN/m². The slab counterpart of the pressure envelope: a
 * deck is loaded downward by weight rather than sideways by head, so none of the
 * rate-and-temperature machinery applies and a different set of minimums does.
 *
 * The minimums are the point of this module. ACI 347 §2.2.1 does not ask for the
 * calculated dead-plus-live load — it asks for that *or* a floor, whichever is
 * greater. Two floors, and they bite in different places:
 *
 * The *live* floor bites constantly. It is 2.4 kPa and a project that states
 * anything below it has understated the crew, the barrow and the impact of
 * discharge, so `liveLoadKpa` is a request rather than an instruction.
 *
 * The *combined* floor bites rarely but catastrophically. At 4.8 kPa against a
 * 26.5 kN/m³ loaded weight it only governs below about 70 mm — a topping on
 * permanent metal deck, a screed, a thin repair pour. Those are exactly the pours
 * whose falsework gets eyeballed because "it is only 50 mm", and 4.8 kPa is nearly
 * double what 50 mm of concrete plus a 2.4 kPa crew comes to.
 *
 * See `wiki/formwork/reference/design.md` §1.7.
 */

/** ACI 347 §2.2.1 minimum live load, kPa. Workers, equipment, stored material, impact. */
export const MIN_LIVE_LOAD_KPA = 2.4

/** The same, where motorized carts run on the deck. */
export const MIN_LIVE_LOAD_CARTS_KPA = 3.6

/** ACI 347 §2.2.1 minimum combined dead + live, kPa. */
export const MIN_COMBINED_KPA = 4.8

/** The same, with motorized carts. */
export const MIN_COMBINED_CARTS_KPA = 6.0

/**
 * Weight of the deck, joists, bearers and props themselves, kPa. ACI's range is
 * 0.25–0.75; the upper end is a timber-beam deck with props at close centres and
 * is the safe default for a system whose parts have not been picked yet.
 */
export const DEFAULT_FORMWORK_SELF_WEIGHT_KPA = 0.5

/** Reinforcement in an ordinary suspended slab, kN/m³ of concrete — about 1 % by volume. */
export const DEFAULT_REBAR_KN_M3 = 1.5

export interface VerticalLoadInput {
  slabThicknessM: number
  /** Concrete unit weight, kN/m³. Defaults to normal-weight. */
  unitWeightKnM3?: number
  /** Deck, joists, bearers and props, kPa. */
  formworkSelfWeightKpa?: number
  /** Reinforcement, kN/m³ of concrete. */
  rebarKnM3?: number
  /** A live load the project has specified, kPa. Raised to the code minimum if lower. */
  liveLoadKpa?: number
  /** Powered buggies on the deck, which raises both the live and the combined floor. */
  motorizedCarts?: boolean
}

export type VerticalLoadGoverning = 'calculated' | 'code-minimum'

export interface VerticalLoad {
  /** What the falsework is designed to, kPa. */
  totalKpa: number
  deadKpa: number
  liveKpa: number
  /** Whether the arithmetic or ACI's floor produced `totalKpa`. */
  governedBy: VerticalLoadGoverning
  /** The dead + live sum before the floor was applied, kPa. */
  calculatedKpa: number
  /** The floor that applied, kPa. */
  minimumKpa: number
  /** Where the live load came from — stated, or lifted to the code minimum. */
  liveGovernedBy: 'specified' | 'code-minimum'
}

export function verticalLoad(input: VerticalLoadInput): VerticalLoad {
  const unitWeight = input.unitWeightKnM3 ?? DEFAULT_UNIT_WEIGHT_KN_M3
  const thickness = Math.max(0, input.slabThicknessM)
  const rebar = input.rebarKnM3 ?? DEFAULT_REBAR_KN_M3
  const selfWeight = input.formworkSelfWeightKpa ?? DEFAULT_FORMWORK_SELF_WEIGHT_KPA

  const deadKpa = thickness * (unitWeight + rebar) + selfWeight

  const liveFloor = input.motorizedCarts ? MIN_LIVE_LOAD_CARTS_KPA : MIN_LIVE_LOAD_KPA
  const specified = input.liveLoadKpa
  const liveKpa = Math.max(liveFloor, specified ?? 0)
  const liveGovernedBy =
    specified !== undefined && specified >= liveFloor ? 'specified' : 'code-minimum'

  const calculatedKpa = deadKpa + liveKpa
  const minimumKpa = input.motorizedCarts ? MIN_COMBINED_CARTS_KPA : MIN_COMBINED_KPA
  const totalKpa = Math.max(calculatedKpa, minimumKpa)

  return {
    totalKpa,
    deadKpa,
    liveKpa,
    governedBy: totalKpa > calculatedKpa ? 'code-minimum' : 'calculated',
    calculatedKpa,
    minimumKpa,
    liveGovernedBy,
  }
}
