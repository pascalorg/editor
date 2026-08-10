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
export const MeasurementStandardChoice = z.enum(['IS_1200_5', 'NRM2', 'HKSMM4', 'CESMM4', 'POMI'])
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

/**
 * What the yard owns, by catalog id — the stock a bill draws on before it hires.
 *
 * A project decision like everything else here, and for the sharpest version of the
 * usual reason: ownership is not a property of a wall. The same 200 panels serve every
 * shutter in the model in turn, so a copy per element would let two walls each believe
 * they had the whole rack.
 *
 * A count per id rather than a boolean per type, because ownership is a *pool*. A yard
 * that owns 200 of a panel and needs 260 hires 60, and a flag would put all 260 on
 * hire the moment the job outgrew the rack by one.
 *
 * The group being **absent** and being **empty** are different claims, which is why
 * this is optional and its own group rather than a field defaulting to `{}`. Empty
 * means the project has said it owns nothing — a real answer a costing pass can use.
 * Absent means nobody has said, and the takeoff leaves the split off entirely rather
 * than reporting a whole bill on hire that the project never claimed. Same
 * distinction the design report draws between "assumed" and "project".
 */
export const FormworkStockSettings = z.object({
  /**
   * Owned quantity per catalog id — `{ 'framax-xlife-0.60x2.70': 200 }`.
   *
   * Integers because a rack holds whole panels, and non-negative because "owns −3" is
   * a shortage rather than a stock level and belongs to the schedule, not here.
   */
  owned: z.record(z.string().trim().max(120), z.number().int().nonnegative()).optional(),
})
export type FormworkStockSettings = z.infer<typeof FormworkStockSettings>

/**
 * What one of a catalog part costs this project.
 *
 * Two figures rather than one, and not a `basis` discriminator, because the basis is a
 * property of the *line* rather than of the part. `bomSupply` has already decided which
 * of a panel type's 26 are off the yard's rack, which are hired and which are spent, and
 * a `basis: 'purchase'` recorded here against a panel the bill hires would be a second
 * answer to a question already answered — with no rule for which of the two wins.
 *
 * So the part carries what it is worth and what it costs to hold, and the bill decides
 * which applies. A hired panel drilled for this pour needs *both*: the hire while it is
 * held, and the list price recharged because it does not go back as stock.
 *
 * `rentalPercentPerMonth` is how the trade actually quotes hire — a percentage of new
 * value per month, typically 2–4 % — which is why it is a percentage of
 * `purchasePerUnit` rather than a second money figure. `rentalPerUnitPerMonth` is for a
 * desk that quoted a flat rate, and it wins over the percentage: an actual quote beats a
 * rule of thumb applied to a list price.
 */
export const PartRate = z.object({
  /** List price of one, new — what a recharge is charged at and what a percentage is of. */
  purchasePerUnit: z.number().finite().positive().max(10_000_000).optional(),
  /** Hire as a percentage of new value per month. 2–4 % is the usual band. */
  rentalPercentPerMonth: z.number().finite().positive().max(100).optional(),
  /** A flat hire quote per unit per month, which overrides the percentage. */
  rentalPerUnitPerMonth: z.number().finite().positive().max(1_000_000).optional(),
})
export type PartRate = z.infer<typeof PartRate>

/**
 * What the project pays, by catalog id — the one input a bill needs that no code
 * publishes and no product carries.
 *
 * On the project rather than on the catalog entry, which is the decision this group
 * exists to record. `CatalogEntry` carries a weight and a `catalogSource` naming the
 * published table it came from, and a price has no such table: the same Framax panel is
 * different money to two yards in the same city, different money to the same yard next
 * quarter, and different money again under a framework agreement. A field on the shipped
 * catalog would make that a fact about the product and drift with the catalog edition,
 * against the whole reason `verification` is on those entries.
 *
 * Absent and empty are different claims, exactly as in `FormworkStockSettings.owned`:
 * absent means nobody has recorded rates and the takeoff carries no money at all, empty
 * means the project has opened the table and stated nothing in it, which prices the same
 * and reads differently. `minHireDays` sits on the group rather than on each part because
 * a minimum hire period is a term of an *agreement*, not a property of a product — the
 * same reasoning that puts the rates on the project rather than on the catalog — and
 * repeating it against forty ids is forty copies of one number, thirty-nine of which go
 * stale.
 */
export const FormworkRateSettings = z.object({
  /** ISO 4217, so a figure is never shown as a bare number. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  /**
   * The agreement's minimum hire period, days. A line held two days against a 28-day
   * minimum is charged for 28, which is most of the cost of a fast cycle.
   */
  minHireDays: z.number().int().positive().max(3650).optional(),
  /** Rate per catalog id — `{ 'framax-xlife-0.60x2.70': { purchasePerUnit: 210 } }`. */
  byCatalogId: z.record(z.string().trim().max(120), PartRate).optional(),
})
export type FormworkRateSettings = z.infer<typeof FormworkRateSettings>

/**
 * How the concrete is cured, which is what decides when the form comes off.
 *
 * A separate group from `placement` rather than three more fields in it, because it
 * is a different half of the pour: `placement` is what happens while the concrete
 * goes in and `curing` is what happens after it stops. The distinction is not
 * cosmetic — the two halves take *different temperatures*, and folding them together
 * is how a January pour gets July's strike time.
 *
 * `surfaceTemperatureC` is the concrete's surface while it cures, which is BS 8110
 * Table 6.2's `t`. It is deliberately not derived from `placement.concreteTemperatureC`:
 * that is the mix as it arrives, and concrete placed at 20 °C into a form standing in
 * 4 °C air does not cure at 20. Worse, the two move the design in *opposite*
 * directions — a colder mix raises the pressure the form is built for, and a colder
 * cure lengthens the time it is held — so a single field would make one of the two
 * answers wrong whichever value it held.
 */
export const CuringSettings = z.object({
  /** Concrete surface temperature while it cures, °C. Not the placing temperature. */
  surfaceTemperatureC: z.number().finite().min(-20).max(60).optional(),
  /**
   * High-early-strength concrete. Both codes permit a shorter period and neither
   * attaches a factor to it, so this shortens nothing — it reports that the reduction
   * is there for the engineer to approve.
   */
  highEarlyStrength: z.boolean().optional(),
  /**
   * The soffit form comes away without disturbing the props — a drophead or
   * early-strip system. ACI 347 footnote ‡ halves the form's period, floored at 3
   * days, and this is the clause the whole drophead market exists on.
   */
  shoresRemain: z.boolean().optional(),
})
export type CuringSettings = z.infer<typeof CuringSettings>

export const FormworkProjectSettingsNode = BaseNode.extend({
  id: objectId('formwork-settings'),
  type: nodeType('formwork-settings'),
  children: z.array(z.string()).default([]),

  pressureStandard: PressureStandardChoice.optional(),
  measurementStandard: MeasurementStandardChoice.optional(),
  concrete: ConcreteMixSettings.optional(),
  placement: PlacementSettings.optional(),
  curing: CuringSettings.optional(),
  falseworkLoads: FalseworkLoadSettings.optional(),
  bracing: BracingSettings.optional(),
  parts: FormworkPartSettings.optional(),
  stock: FormworkStockSettings.optional(),
  rates: FormworkRateSettings.optional(),
}).describe(
  dedent`
  Formwork project settings - the pour every shutter in the scene is designed against. One per scene.
  - pressureStandard: which code derives the fresh-concrete pressure; follows the contract, not a preference
  - measurementStandard: the contract's quantity rules (IS 1200, NRM2, HKSMM4, CESMM4, POMI)
  - concrete: the mix — density/unit weight, consistency class, slump, cement blend, admixtures, setting time
  - placement: how the pour is done — rate of rise, concrete temperature, vibration, pumped from base
  - curing: what happens after the pour, which sets the striking time — surface temperature while curing (NOT the placing temperature), high-early-strength concrete, whether the soffit form leaves its props behind
  - falseworkLoads: soffit dead and live loads beyond the concrete itself, each raised to the ACI floor
  - bracing: wind, form weight and raker geometry for wall forms
  - parts: catalog ids for the panel system, sheathing, beam section and prop
  - stock.owned: how many of each catalog id the yard owns, by id; a bill draws on these before it hires. Absent means nobody has said what the project owns, and the takeoff reports no owned/hired split at all rather than putting the whole bill on hire
  - rates: what the project pays per catalog id — list price, and hire as a percentage of it per month or as a flat monthly rate — plus the agreement's currency and minimum hire period. Here rather than on the catalog because a price is a fact about this project's commercial terms, not about a product: the same panel is different money to two yards. Absent means no rates recorded and the takeoff carries no money at all
  `,
)
export type FormworkProjectSettingsNode = z.infer<typeof FormworkProjectSettingsNode>
export type FormworkProjectSettingsId = FormworkProjectSettingsNode['id']
