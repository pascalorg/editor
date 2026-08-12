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
  /**
   * All-in cost of one man-hour of the gang — the rate that turns output norms into money.
   *
   * Here rather than in `labour` beside the norms it multiplies, because it is money and
   * the currency it is in is stated once, above. A gang rate in one group and the currency
   * it is denominated in in another is how a takeoff comes to hold two figures in
   * different money and one total.
   *
   * On its own it prices nothing: the hours come from `labour.byPartKind`, and a project
   * that states a rate and no norms gets no labour at all rather than a rate applied to
   * an invented output.
   */
  gangRatePerHour: z.number().finite().positive().max(100_000).optional(),
  /**
   * What one delivery load costs, one way — the charge a haulier makes per lorry.
   *
   * Per load rather than per tonne or per kilometre, because that is how the trade quotes
   * it: a yard sends a lorry and is invoiced for the lorry, and a part-loaded one costs
   * what a full one does. Distance is already inside the figure the haulier gave, which is
   * why there is no site address anywhere in this model.
   *
   * One way, because the loads out and the loads back are counted separately and are not
   * the same number: what is consumed on the job does not come back.
   */
  transportPerLoad: z.number().finite().positive().max(1_000_000).optional(),
  /**
   * What an hour of the crane costs, all-in with its operator and slinger.
   *
   * Here beside the gang rate for the same reason it is: it is money, and the currency it
   * is in is stated once above. On its own it prices nothing — the hook time comes from
   * `logistics.minutesPerPick` against the picks the layout produced.
   *
   * A rate a *mobile* crane is hired at. A tower crane standing on the job is a
   * preliminary charged by the week whether it lifts this or not, and every surface says
   * so rather than leaving a reader to work out which of the two they have.
   */
  cranePerHour: z.number().finite().positive().max(1_000_000).optional(),
})
export type FormworkRateSettings = z.infer<typeof FormworkRateSettings>

/**
 * Which part kinds a norm can be stated against.
 *
 * A duplicate of `FormworkPartKind` in `systems/formwork/parts.ts`, and it has to be:
 * the schema layer is below the systems layer and cannot import from it. `labour.test.ts`
 * asserts the two lists are the same, so a thirteenth kind cannot arrive with nowhere to
 * record its hours.
 */
export const FormworkPartKindChoice = z.enum([
  'panel',
  'filler',
  'corner',
  'stop-end',
  'waler',
  'joist',
  'tie',
  'ply-piece',
  'prop',
  'brace',
  'accessory',
  'consumable',
])
export type FormworkPartKindChoice = z.infer<typeof FormworkPartKindChoice>

/**
 * Man-hours to fit one of a kind of part, and to take it off again.
 *
 * Two figures rather than one with a factor, because they are two operations weeks
 * apart on different halves of a bill, and striking is not the erect reversed — a tie is
 * a spanner one way and a cut rod, a patched cone and a made-good face the other. Either
 * may be stated alone, and the takeoff reports that as half an operation rather than
 * deriving the missing one.
 */
export const LabourNormEntry = z.object({
  /** Man-hours to fit one, once. */
  erectHours: z.number().finite().positive().max(100).optional(),
  /** Man-hours to strike one. */
  strikeHours: z.number().finite().positive().max(100).optional(),
})
export type LabourNormEntry = z.infer<typeof LabourNormEntry>

/**
 * The project's own output norms — how long its gang takes, per kind of part.
 *
 * Stated by the project rather than shipped, and the reason is stronger than the one
 * that puts prices here. Published constants do exist: CPWD's Analysis of Rates prints
 * carpenter and mazdoor days per 10 m² of shuttering, and Spon's and RSMeans print hours
 * per m² and daily crew outputs. None of them is a table this engine can apply. They are
 * per m² of a whole trade operation that already contains the backing, the props, the
 * ties and the strike, so spreading one over a bill of parts charges the same work
 * several times — and an output norm is a fact about a *gang* rather than about a product
 * or a code, so the same crew on its tenth identical floor beats its own figure from the
 * first. There is nothing conservative to fall back to, exactly as with a price.
 *
 * Absent and empty are the same distinction the rack and the rates draw: absent means
 * nobody has stated a norm and the takeoff carries no hours at all, empty means the
 * project has opened the table and entered nothing. A kind with no norm is reported as
 * uncovered fittings rather than costed at zero, because a bill whose panels are normed
 * and whose ties are not reads complete and is short by every tie in the job.
 */
export const FormworkLabourSettings = z.object({
  /** Norm per part kind — `{ panel: { erectHours: 0.35, strikeHours: 0.2 } }`. */
  byPartKind: z.record(FormworkPartKindChoice, LabourNormEntry).optional(),
})
export type FormworkLabourSettings = z.infer<typeof FormworkLabourSettings>

/**
 * How the programme turns a pour date into the days the plant is on site.
 *
 * A project decision rather than a per-shutter one for the usual reason, and a stronger
 * one than the rack's: erecting a shutter takes as long as this gang takes, and a
 * different figure per wall would be a claim about the walls rather than about the crew.
 * The *dates* are per pour and live on the assembly (`FormworkAssemblyNode.pourAt`);
 * what turns one into an erect date and a release date is this.
 *
 * Both are undefaulted, and this is the group where that matters most after the rates.
 * A strike period has a published table behind it, so silence has a conservative answer.
 * A lead time has none — it is how this yard works — and a default of zero would say the
 * form appears on the morning of the pour, which is the one answer that is certainly
 * wrong. So absent means the programme reports the pour and the strike and says nothing
 * about the days either side.
 *
 * Both are **calendar** days, not working days, and the distinction is a decision rather
 * than a simplification. Everything these figures are added to is calendar: a hire is
 * charged over a weekend, and a striking period is either calendar time or an
 * accumulator over qualifying hours — neither is a working week. Skipping weekends would
 * need a working calendar and a holiday list that nothing in this model carries, and the
 * result would be a delivery date the hire invoice disagrees with.
 */
export const FormworkScheduleSettings = z.object({
  /**
   * Calendar days between the plant arriving and the concrete going in, per pour.
   *
   * What a delivery date is calculated back from, and it covers erecting, aligning and
   * checking the shutter rather than only unloading it.
   */
  erectionLeadDays: z.number().finite().min(0).max(365).optional(),
  /**
   * Calendar days between striking and the plant being available again.
   *
   * Cleaning, repair and the trip back. It is why a set is not free the moment it comes
   * off: a hire runs to the return, and the next pour cannot have it either.
   */
  returnLeadDays: z.number().finite().min(0).max(365).optional(),
})
export type FormworkScheduleSettings = z.infer<typeof FormworkScheduleSettings>

/**
 * One point off a crane's published load chart: what it lifts at this radius.
 *
 * A curve rather than a single figure because a crane's capacity is not a number, and
 * treating it as one is the mistake this group exists to prevent. A tower crane rated at
 * 8 t lifts 8 t near the mast and 2.2 t at the jib tip; the figure on the front of the
 * brochure is the one that applies where nothing is ever built. So a gang 40 m out is
 * checked against the chart at 40 m, and a project that records only the headline rating
 * has recorded the wrong number.
 */
export const CraneCapacityPoint = z.object({
  /** Distance from the slew centre, m. */
  radiusM: z.number().finite().positive().max(200),
  /** What the chart says the hook takes there, kg. */
  capacityKg: z.number().finite().positive().max(1_000_000),
})
export type CraneCapacityPoint = z.infer<typeof CraneCapacityPoint>

/**
 * The crane, which is a fact about this site and about nothing else.
 *
 * Undefaulted like the rates and the rack, and for the rates' reason rather than the
 * rack's: there is no conservative crane. Ship a curve and every gang in every project
 * is checked against a machine nobody hired — passing gangs that do not lift on the
 * site's actual crane, and failing gangs that lift perfectly well. So absent means the
 * takeoff groups a face into one gang, prints its weight, and says no crane was stated.
 *
 * The whole curve is one fact and is written whole: patching it replaces it rather than
 * merging point by point, because half of one chart mixed with half of another is a
 * machine that does not exist.
 */
export const FormworkCraneSettings = z.object({
  /**
   * The load chart, point by point. Order does not matter — it is sorted on the way in.
   *
   * Two points are enough to be useful (the near rating and the tip), and more is
   * better: the reading between points is a straight line and a real chart sags below
   * one.
   */
  capacityCurve: z.array(CraneCapacityPoint).max(40).optional(),
  /**
   * Height available between the top of a gang and the hook, m.
   *
   * What the slings have to fit in. A gang wide enough to need its eyes 4 m apart wants
   * about 1.7 m of headroom at 60°, and a crane that has not got it cannot lift that
   * gang however light it is.
   */
  hookHeightM: z.number().finite().positive().max(300).optional(),
  /**
   * Widest gang that can be handled, mm. Usually the road rather than the crane: a gang
   * assembled off site travels on a lorry, and past about 3 m that is a permit.
   */
  maxGangWidthMm: z.number().finite().positive().max(30_000).optional(),
  /**
   * Minimum sling angle from the horizontal, degrees. Below about 45° the leg tension
   * runs away — at 30° each leg carries the whole gang — which is why a lifting plan
   * states a floor rather than a target.
   */
  minSlingAngleDeg: z.number().finite().min(15).max(89).optional(),
})
export type FormworkCraneSettings = z.infer<typeof FormworkCraneSettings>

/**
 * How the formwork gets to the job and off the lorry — the two costs outside every total.
 *
 * `cost.excludes` has named transport and craneage on every surface since the money
 * arrived, and until the layout was ganged neither had a quantity to hang off. A delivery
 * is priced per load and a crane per lift, and a bill of 2,400 parts is neither: it is the
 * weight the lorries carry and the number of times the hook goes up, which are two
 * different sweeps of two different things.
 *
 * The two figures here are the *job's* facts, and both are undefaulted for the rates'
 * reason rather than the rack's. A payload is a fact about the lorry a yard actually sends
 * — 8 t on a rigid, 24 t on an artic, less again where the site gate decides it — and a
 * minute per pick is a fact about a crew and a crane on one site. There is no conservative
 * figure for either: a payload set low invents lorries and one set high loses them, and a
 * cycle time is the difference between a tower crane over the pour and a mobile tracking
 * round a slab. So absent means the takeoff carries no transport and no craneage at all,
 * exactly as an absent norm means it carries no hours.
 */
export const FormworkLogisticsSettings = z.object({
  /**
   * What one lorry carries, kg — the payload the loads are counted against.
   *
   * The bill's weight over this is the number of loads, rounded up, and the rounding is
   * the answer rather than a detail: 8.2 t on an 8 t lorry is two loads and the second one
   * costs what the first did.
   */
  lorryPayloadKg: z.number().finite().positive().max(100_000).optional(),
  /**
   * Minutes of hook time one pick takes — sling, lift, land, release and hook back.
   *
   * The whole cycle rather than the lift, because a crane is hired by the hour and the two
   * minutes it spends in the air are the smallest part of the twenty it is booked for.
   */
  minutesPerPick: z.number().finite().positive().max(600).optional(),
  /**
   * Loads that go out and do not come back, as a fraction of the outbound ones.
   *
   * Absent means every load returns, which is what a returnable bill does. State it where
   * a job's formwork is largely consumed — a job of cut ply and site-made soldiers sends
   * lorries out and brings a fraction of them back, and counting a return leg for each one
   * doubles a real charge.
   */
  returnLoadFraction: z.number().finite().min(0).max(1).optional(),
})
export type FormworkLogisticsSettings = z.infer<typeof FormworkLogisticsSettings>

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
  labour: FormworkLabourSettings.optional(),
  schedule: FormworkScheduleSettings.optional(),
  crane: FormworkCraneSettings.optional(),
  logistics: FormworkLogisticsSettings.optional(),
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
  - rates: what the project pays per catalog id — list price, and hire as a percentage of it per month or as a flat monthly rate — plus the agreement's currency, minimum hire period, the all-in cost of one man-hour of the gang, the charge per delivery load and the hourly rate of a mobile crane. Here rather than on the catalog because a price is a fact about this project's commercial terms, not about a product: the same panel is different money to two yards. Absent means no rates recorded and the takeoff carries no money at all
  - labour: man-hours to erect and to strike one of each kind of part, as this project's own gang works. Stated rather than shipped because an output norm is a fact about a crew, not about a product or a code — published constants are per m² of a whole trade operation and cannot be spread over a bill of parts without charging the same work twice. Absent means the takeoff carries no hours at all; a kind left out is reported as uncovered fittings rather than costed at zero
  - schedule: calendar days (not working days — a hire is charged over a weekend) for erecting a shutter before its pour and for getting the plant back after striking. The pour dates themselves are per pour, on each formwork-assembly's pourAt. Absent means the programme reports the pour and strike days only
  - crane: the site's own crane — its load chart as capacity against radius, the height under the hook, the widest gang that can be moved, and the minimum sling angle. A capacity curve rather than a rating because a tower crane rated 8 t lifts 2.2 t at the jib tip, and a gang is checked at the radius it is actually set at. Absent means each face is grouped as one gang and nothing is checked against a lift — there is no conservative default crane, and a shipped curve would pass gangs that do not lift and fail gangs that do
  - logistics: what one lorry carries and how many minutes of hook time a pick takes, which is what turns a bill's weight into loads and a lifting schedule into crane hours. The two costs every total in this model has excluded since the money arrived, and both figures are facts about this job's own plant rather than about a product: a payload is the lorry the yard sends and a cycle time is this crew on this crane. Absent means the takeoff carries no transport and no craneage at all, as an absent norm means it carries no hours
  `,
)
export type FormworkProjectSettingsNode = z.infer<typeof FormworkProjectSettingsNode>
export type FormworkProjectSettingsId = FormworkProjectSettingsNode['id']
