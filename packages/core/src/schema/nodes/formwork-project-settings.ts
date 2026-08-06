import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * The pour, as the project has decided it — the inputs every shutter in the
 * model is designed against.
 *
 * These are project decisions rather than element ones, and that is the whole
 * reason the node exists. The concrete arrives from one plant at one temperature
 * and rises at a rate the pump sets; the design code follows the contract and
 * the engineer of record. A copy of those per wall would let two shutters either
 * side of one junction be designed to different pours, which is the specific
 * failure `designEnvelope` was written to prevent — and it could not prevent it
 * while its own inputs were hardcoded constants nobody could see or change.
 *
 * It is a node rather than a slice of store state so that it saves, loads,
 * undoes and round-trips with the scene like everything else, and so the AI can
 * read and write it through the same `updateNode` path as any other edit. One
 * per scene, parented to the site.
 *
 * Absent means the shipped defaults, which are the conservative reading rather
 * than a neutral one: DIN's fastest covered rise rate at its own reference
 * temperature. A scene that has never opened the dialog is therefore designed to
 * something defensible, and the dialog's job is to let a project claim the
 * saving a slower pour earns rather than to make the design possible.
 *
 * Nothing here is a *result*. Every field is an input the engine reads; the
 * numbers it produces live in the design report and are recomputed, never
 * stored.
 */

/**
 * Which code the pressure is derived under. Not a preference — a rating
 * certified against one standard is not a check against another, and the panel
 * systems in the catalog publish theirs against DIN. See
 * `systems/formwork/pressure/index.ts` for why that makes DIN the default.
 */
export const PressureStandardChoice = z.enum([
  'ACI_347',
  'DIN_18218',
  'CIRIA_108',
  'BS_5975_SHORTCUT',
])
export type PressureStandardChoice = z.infer<typeof PressureStandardChoice>

/** The contract's measurement rules — what the client actually pays for. */
export const MeasurementStandardChoice = z.enum([
  'IS_1200_5',
  'NRM2',
  'HKSMM4',
  'CESMM4',
  'POMI',
])
export type MeasurementStandardChoice = z.infer<typeof MeasurementStandardChoice>

/**
 * DIN's consistency classes. Not a slump number: the class sets both the
 * constant term and the slope on the rise rate, and SCC sits outside the F
 * series because it is flowable but not vibrated.
 */
export const ConsistencyClassChoice = z.enum(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'SCC'])
export type ConsistencyClassChoice = z.infer<typeof ConsistencyClassChoice>

/**
 * The binder, asked as what it *is* rather than as the coefficient it implies —
 * ACI's `Cc` and CIRIA's `C2` are lookups on the same three questions, so asking
 * once is the only way the two codes can be compared on one mix.
 *
 * `superplasticizer` is its own field because ACI's Table 2.2 footnote counts a
 * high-range water reducer that delays setting *as* a retarder. It is the most
 * commonly missed clause in the chapter and worth 20 % of the pressure, and a UI
 * that folds it into "retarder?" will be answered wrong.
 */
export const CementSpecSettings = z.object({
  /** Fraction of the binder replaced by ggbs, 0–1. Over 0.70 is ACI's high blend. */
  slagFraction: z.number().min(0).max(1).optional(),
  /** Fraction replaced by fly ash, 0–1. Over 0.40 is ACI's high blend. */
  flyAshFraction: z.number().min(0).max(1).optional(),
  retarder: z.boolean().optional(),
  superplasticizer: z.boolean().optional(),
})
export type CementSpecSettings = z.infer<typeof CementSpecSettings>

/**
 * The concrete as the codes measure it.
 *
 * `densityKgM3` and `unitWeightKnM3` are deliberately independent rather than
 * derived from one another: ACI brackets normal-weight concrete at 2240–2400
 * kg/m³ while DIN validates its coefficients at 25 kN/m³ (about 2550 kg/m³), so
 * converting either into the other moves a design out of the band its own table
 * came from. Both are optional and each code takes its own default.
 */
export const ConcreteMixSettings = z.object({
  /** ACI's `w`, kg/m³. */
  densityKgM3: z.number().finite().positive().max(5000).optional(),
  /** DIN's and CIRIA's `γc`, kN/m³. */
  unitWeightKnM3: z.number().finite().positive().max(50).optional(),
  consistencyClass: ConsistencyClassChoice.optional(),
  slumpMm: z.number().finite().min(0).max(300).optional(),
  selfCompacting: z.boolean().optional(),
  cement: CementSpecSettings.optional(),
  /** DIN's `tE` — end of setting, hours, at the reference temperature. */
  endOfSettingH: z.number().finite().positive().max(48).optional(),
  /** DIN's `TRef`, °C. Only its difference from the placing temperature matters. */
  referenceTemperatureC: z.number().finite().min(-20).max(60).optional(),
  /**
   * CIRIA's `C2`, overriding what the cement spec implies. Exposed because it is
   * the least verified coefficient in the reference and a job may have been
   * handed one.
   */
  ciriaC2: z.number().finite().positive().max(10).optional(),
})
export type ConcreteMixSettings = z.infer<typeof ConcreteMixSettings>

/**
 * How the pour is actually carried out, which is most of the answer.
 *
 * There is no `pourHeightM` or `elementKind` here even though `Placement` has
 * both: those are read off each element's own lift and plan dimensions, and a
 * project-level copy would be a second source of truth for something the
 * geometry already knows.
 */
export const PlacementSettings = z.object({
  /** Rate of rise, m/h — the pump rate over the plan area if pumped. */
  riseRateMH: z.number().finite().positive().max(50).optional(),
  /** Concrete temperature at placing, °C. Not the air temperature. */
  concreteTemperatureC: z.number().finite().min(-10).max(50).optional(),
  vibration: z.enum(['internal', 'external', 'none']).optional(),
  /** How deep the poker goes, m. Past 1.2 m ACI's special cases are void. */
  vibratorImmersionDepthM: z.number().finite().positive().max(10).optional(),
  /** Pumped in at the base of the form rather than placed from the top. */
  pumpedFromBase: z.boolean().optional(),
})
export type PlacementSettings = z.infer<typeof PlacementSettings>

/**
 * The vertical loads a soffit carries beyond the concrete's own weight. Each is
 * raised to ACI §2.2.1's floor if it is stated lower, so entering a small figure
 * here cannot design a deck below the code.
 */
export const FalseworkLoadSettings = z.object({
  /** Deck, joists, bearers and props themselves, kPa. */
  formworkSelfWeightKpa: z.number().finite().min(0).max(10).optional(),
  /** Reinforcement, kN/m³ of concrete. */
  rebarKnM3: z.number().finite().min(0).max(10).optional(),
  /** Live load, kPa. Raised to the code minimum if lower. */
  liveLoadKpa: z.number().finite().min(0).max(50).optional(),
  /** Powered buggies on the deck, which raises both the live and the combined floor. */
  motorizedCarts: z.boolean().optional(),
})
export type FalseworkLoadSettings = z.infer<typeof FalseworkLoadSettings>

/**
 * What holds a wall form on line. A wall form is not braced against the concrete
 * — the ties do that — but against wind, against the impact of dumping, and
 * against the code's own minimum, whichever is largest.
 */
export const BracingSettings = z.object({
  /** Wind pressure on the form, kN/m². Defaults to the code minimum for an exposed wall. */
  windPressureKpa: z.number().finite().min(0).max(10).optional(),
  /** Weight of the form the bracing holds, kN/m of wall — ACI's 2 % term. */
  formDeadLoadKnM: z.number().finite().min(0).max(100).optional(),
  /** Raker centres along the wall, m. */
  rakerSpacingM: z.number().finite().positive().max(20).optional(),
  /** Raker inclination from the horizontal, degrees. */
  rakerAngleDeg: z.number().finite().min(5).max(85).optional(),
  /**
   * Braced by guy wires rather than inclined rakers. A guy takes tension only,
   * so it needs a partner opposite; a raker takes both and one line will do.
   */
  guyWires: z.boolean().optional(),
})
export type BracingSettings = z.infer<typeof BracingSettings>

/**
 * The parts the design chain resolves against, by catalog id. These have had no
 * schema home at all until now, which is why the chain has been reading its own
 * hardcoded defaults for the sheathing and the beam section.
 */
export const FormworkPartSettings = z.object({
  /** Panel system for wall and column forms. Absent means the shipped default. */
  systemId: z.string().trim().max(120).optional(),
  /** Face material — the ply or the panel's formlining. */
  sheathingId: z.string().trim().max(120).optional(),
  /** The section used for studs, walers, joists and bearers alike. */
  beamId: z.string().trim().max(120).optional(),
  propId: z.string().trim().max(120).optional(),
  /** Walers paired either side of the tie, which halves what each member bends under. */
  doubledWalers: z.boolean().optional(),
})
export type FormworkPartSettings = z.infer<typeof FormworkPartSettings>

export const FormworkProjectSettingsNode = BaseNode.extend({
  id: objectId('formwork-settings'),
  type: nodeType('formwork-settings'),
  children: z.array(z.string()).default([]),

  pressureStandard: PressureStandardChoice.optional(),
  measurementStandard: MeasurementStandardChoice.optional(),
  concrete: ConcreteMixSettings.optional(),
  placement: PlacementSettings.optional(),
  falseworkLoads: FalseworkLoadSettings.optional(),
  bracing: BracingSettings.optional(),
  parts: FormworkPartSettings.optional(),
}).describe(
  dedent`
  Formwork project settings - the pour every shutter in the scene is designed against. One per scene.
  - pressureStandard: which code derives the fresh-concrete pressure; follows the contract, not a preference
  - measurementStandard: the contract's quantity rules (IS 1200, NRM2, HKSMM4, CESMM4, POMI)
  - concrete: the mix — density/unit weight, consistency class, slump, cement blend, admixtures, setting time
  - placement: how the pour is done — rate of rise, concrete temperature, vibration, pumped from base
  - falseworkLoads: soffit dead and live loads beyond the concrete itself, each raised to the ACI floor
  - bracing: wind, form weight and raker geometry for wall forms
  - parts: catalog ids for the panel system, sheathing, beam section and prop
  `,
)
export type FormworkProjectSettingsNode = z.infer<typeof FormworkProjectSettingsNode>
export type FormworkProjectSettingsId = FormworkProjectSettingsNode['id']
