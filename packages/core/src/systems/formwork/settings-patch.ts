import { z } from 'zod'
import type {
  CraneCapacityPoint,
  FormworkProjectSettingsNode,
} from '../../schema/nodes/formwork-project-settings'
import {
  FALSEWORK_BEAMS,
  FORMWORK_SYSTEMS,
  PROP_TYPES,
  SHEATHING_TYPES,
  SHEET_STOCK,
  STOCKABLE_CATALOG_PARTS,
} from './catalog'
import type { RateTable } from './cost'
import type { NormTable } from './labour'
import {
  DEFAULT_FORMWORK_SETTINGS,
  type FormworkSettingsGroup,
  formworkSettings,
  mergeFormworkCement,
  mergeFormworkLabourNorms,
  mergeFormworkOwnedStock,
  mergeFormworkRates,
  mergeFormworkSettingsGroup,
} from './settings'

/**
 * The project's pour as an *agent* states it — one write contract for every AI
 * surface, and one reading of it.
 *
 * `settings.ts` owns what "unstated" means once a patch has been formed. This owns
 * the step before that: what an agent is allowed to say, what it means by `null`,
 * which catalog ids are real, and which of the node's two nesting levels a field
 * belongs to. That step was written twice — once in the editor's chat tools and
 * again the moment a second surface needed it — and the two copies fail in a way
 * neither can show. A description that warns the curing temperature is not the
 * placing temperature, present in one copy and absent in the other, is a wrong
 * strike time on whichever surface lacks it, reported with the same confidence.
 *
 * ## Why the schemas are here rather than at each tool
 *
 * The bounds mirror the node's own, and the *descriptions* are the part that must
 * not diverge: they are the only place a model is told that a colder mix raises
 * the pressure while a colder cure lengthens the hold, or that a hallucinated part
 * id falls back silently rather than failing. They are as much a part of the write
 * contract as the ranges, and a second author writing a second set will write
 * neither the same warnings nor the same omissions.
 *
 * ## `null` is a third state, and it is the reason this is not the node schema
 *
 * The node's own schema has two states per field: stated, or absent. An agent needs
 * three — state it, leave it alone, or hand it back. Without the third a model can
 * set a figure and never retract it, and every assumption in a project decays into
 * a claim over the course of a conversation, which is precisely the distinction the
 * design report exists to draw. So each field is `.nullable().optional()` over the
 * node's own bounds, `null` becomes the `undefined` the merge helpers spell as
 * "unstate", and an absent key is left alone.
 *
 * ## What this deliberately does not do
 *
 * It does not write. `applyFormworkSettingsPatch` returns the writes and the caller
 * applies them, because the two callers apply them differently — the chat tools
 * mutate a plain graph on the server, MCP goes through the store's `updateNode` —
 * and both already agree that an explicitly-`undefined` key deletes it. A shared
 * writer would have to know about a store, which is the boundary this package sits
 * on the wrong side of.
 */

const CONCRETE_PATCH = z.object({
  densityKgM3: z.number().positive().max(5000).nullable().optional().describe("ACI's w, kg/m³"),
  unitWeightKnM3: z
    .number()
    .positive()
    .max(50)
    .nullable()
    .optional()
    .describe("DIN's and CIRIA's γc, kN/m³"),
  consistencyClass: z
    .enum(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'SCC'])
    .nullable()
    .optional()
    .describe(
      "DIN's consistency class. Sets both the constant and the slope on the rise rate. Use SCC here for self-compacting concrete rather than setting a separate flag",
    ),
  slumpMm: z
    .number()
    .min(0)
    .max(300)
    .nullable()
    .optional()
    .describe("over 175 mm ACI's special-case formulas do not apply and the fluid head governs"),
  endOfSettingH: z
    .number()
    .positive()
    .max(48)
    .nullable()
    .optional()
    .describe("DIN's tE. A later set raises the pressure, it does not lower it"),
  referenceTemperatureC: z.number().min(-20).max(60).nullable().optional().describe("DIN's TRef"),
  ciriaC2: z
    .number()
    .positive()
    .max(10)
    .nullable()
    .optional()
    .describe("CIRIA's C2, overriding what the binder implies"),
})

const CEMENT_PATCH = z.object({
  slagFraction: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe("fraction of binder replaced by ggbs; over 0.70 is ACI's high blend"),
  flyAshFraction: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe('fraction replaced by fly ash; over 0.40 is the high blend'),
  retarder: z.boolean().nullable().optional(),
  superplasticizer: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "asked separately from retarder because ACI's Table 2.2 footnote counts a high-range water reducer that delays setting as one — worth 20 % of the pressure",
    ),
})

const PLACEMENT_PATCH = z.object({
  riseRateMH: z
    .number()
    .positive()
    .max(50)
    .nullable()
    .optional()
    .describe('rate of rise, m/h — the pump rate over the plan area, not the truck rate'),
  concreteTemperatureC: z
    .number()
    .min(-10)
    .max(50)
    .nullable()
    .optional()
    .describe("the concrete's temperature at placing, not the air's"),
  vibration: z
    .enum(['internal', 'external', 'none'])
    .nullable()
    .optional()
    .describe(
      'external vibration falls outside both codes and the pressure jumps to the fluid head',
    ),
  vibratorImmersionDepthM: z
    .number()
    .positive()
    .max(10)
    .nullable()
    .optional()
    .describe("poker depth, m; past 1.2 m ACI's special cases are void"),
  pumpedFromBase: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'base-pumped is the full fluid head plus 25 % surge — roughly double a top-placed pour',
    ),
})

const CURING_PATCH = z.object({
  surfaceTemperatureC: z
    .number()
    .min(-20)
    .max(60)
    .nullable()
    .optional()
    .describe(
      'concrete surface temperature while it cures, °C — BS 8110 Table 6.2’s t. NOT placement.concreteTemperatureC, which is the mix as it arrives: concrete placed at 20 °C into a form standing in 4 °C air does not cure at 20, and the two move the design opposite ways — a colder mix raises the pressure, a colder cure lengthens the hold',
    ),
  highEarlyStrength: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'both codes permit a shorter period and neither attaches a factor to it, so this shortens nothing — it reports that the reduction is the engineer’s to approve',
    ),
  shoresRemain: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'the soffit form comes away without disturbing the props — a drophead or early-strip system. ACI 347 footnote ‡ halves the form’s period, floored at 3 days; the props themselves are never halved',
    ),
  maturityTargetDegreeHours: z
    .number()
    .positive()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      'the strength-based striking criterion, as the maturity the concrete must reach before the form comes off — Nurse–Saul M_target, degree-hours, calibrated from job-cured specimens. Ask the engineer for it and never infer it: a guessed target is a check that cannot fail. When recorded, the strike is the later of this criterion and the elapsed-time table, and a criterion missing the curing temperature it accumulates over falls back to elapsed time and says so',
    ),
  maturityDatumC: z
    .number()
    .min(-20)
    .max(60)
    .nullable()
    .optional()
    .describe(
      'the Nurse–Saul datum temperature the maturity target is measured against, °C. Unstated takes 0 °C and says so — a target calibrated against a different datum cannot be compared with this one',
    ),
  requiredStrengthFraction: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe(
      'the required strength the maturity target was calibrated for, as a fraction of the design strength — the way a contract states a strike criterion (~0.7 for props, ~0.5 for soffits with reshores). Report-only naming: the strike is decided by maturityTargetDegreeHours, and this is what it is called in words',
    ),
  designStrengthMpa: z
    .number()
    .positive()
    .max(500)
    .nullable()
    .optional()
    .describe('the concrete’s design strength, MPa, for the naming above'),
})

/**
 * The two lead times, and why neither has a default to hand back to.
 *
 * `null` here means "unstate", as everywhere else, and unstated is a real answer rather
 * than a gap to be filled: a lead time has no published table behind it the way a
 * striking period does, and a default of zero says the shutter arrives on the morning of
 * the pour and goes back to the yard the afternoon it is struck — the one answer that is
 * certainly wrong. So the takeoff reports the gap instead of assuming a figure.
 */
const SCHEDULE_PATCH = z.object({
  erectionLeadDays: z
    .number()
    .finite()
    .min(0)
    .max(365)
    .nullable()
    .optional()
    .describe(
      'calendar days between the plant arriving on site and the pour — delivery, erection, alignment and the pre-pour check. Calendar rather than working days, deliberately: a hire is charged over a weekend, so a programme that skipped weekends would disagree with the invoice for the same set',
    ),
  returnLeadDays: z
    .number()
    .finite()
    .min(0)
    .max(365)
    .nullable()
    .optional()
    .describe(
      'calendar days between striking and the set being available again — stripping, cleaning, repair and the trip back. Where this is unstated the takeoff shows plant free the day it is struck, which is a floor rather than an answer',
    ),
})

/**
 * The crane, and the one field here that is written whole rather than merged.
 *
 * `capacityCurve` replaces what is recorded instead of merging point by point, and that
 * is deliberate against the rule every other table in this file follows. A load chart is
 * one fact about one machine: half of a 40 m jib's chart merged with half of a 55 m one
 * describes a crane that does not exist, and it would pass a check. So a model that
 * states a curve states all of it, and `null` removes it.
 */
const CRANE_PATCH = z.object({
  capacityCurve: z
    .array(
      z.object({
        radiusM: z.number().positive().max(200).describe('distance from the slew centre, m'),
        capacityKg: z
          .number()
          .positive()
          .max(1_000_000)
          .describe('what the published chart says the hook takes at that radius, kg'),
      }),
    )
    .max(40)
    .nullable()
    .optional()
    .describe(
      "the crane's load chart, as capacity against radius. Read it off the published chart and pass every row you have — a capacity between two rows is read on the straight line joining them, and a real chart sags below that line, so a sparse curve reads optimistically. This replaces the recorded curve rather than merging into it, because half of one chart and half of another is a machine that does not exist. Never infer this from a crane's rating: a tower crane rated 8 t lifts 8 t near the mast and about 2.2 t at the jib tip, and the rating is the figure that applies where nothing is built",
    ),
  hookHeightM: z
    .number()
    .positive()
    .max(300)
    .nullable()
    .optional()
    .describe(
      'height available between the top of a gang and the hook, m — what the slings have to fit into. A gang whose lifting eyes sit 4 m apart wants about 1.7 m of it at 60°, so a crane short of headroom cannot lift a wide gang however light it is',
    ),
  maxGangWidthMm: z
    .number()
    .positive()
    .max(30_000)
    .nullable()
    .optional()
    .describe(
      'widest gang that can be handled, mm. Usually the road rather than the crane — a gang assembled off site travels on a lorry, and past about 3 m that is a permit',
    ),
  minSlingAngleDeg: z
    .number()
    .min(15)
    .max(89)
    .nullable()
    .optional()
    .describe(
      'minimum sling angle from the horizontal, degrees. 60 is the ordinary site rule and it is a floor rather than a target: below about 45° the leg tension runs away, and at 30° each leg carries the whole gang',
    ),
})

const FALSEWORK_LOAD_PATCH = z.object({
  formworkSelfWeightKpa: z.number().min(0).max(10).nullable().optional(),
  rebarKnM3: z.number().min(0).max(10).nullable().optional(),
  liveLoadKpa: z
    .number()
    .min(0)
    .max(50)
    .nullable()
    .optional()
    .describe(
      "raised to ACI §2.2.1's floor if stated lower, so a small figure cannot design below the code",
    ),
  motorizedCarts: z
    .boolean()
    .nullable()
    .optional()
    .describe('powered buggies raise both the live-load floor and the combined minimum'),
})

const BRACING_PATCH = z.object({
  windPressureKpa: z.number().min(0).max(10).nullable().optional(),
  formDeadLoadKnM: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe("weight of the form the bracing holds, per metre of wall — ACI's 2 % term"),
  rakerSpacingM: z.number().positive().max(20).nullable().optional(),
  rakerAngleDeg: z.number().min(5).max(85).nullable().optional(),
  guyWires: z
    .boolean()
    .nullable()
    .optional()
    .describe('a guy takes tension only and needs a partner opposite; a raker takes both'),
})

/**
 * The catalog ids each part field accepts, listed in the schema so a model picks
 * from the shipped catalog rather than inventing a plausible product code.
 *
 * Validated again on the way in even so. An id that resolves to nothing does not
 * fail loudly — the design chain falls back to its default part — so a hallucinated
 * `peri-h20` would leave the project believing it had specified a beam while every
 * span was solved against another one.
 */
const SYSTEM_IDS = Object.keys(FORMWORK_SYSTEMS)
const SHEATHING_IDS = SHEATHING_TYPES.map((entry) => entry.id)
const BEAM_IDS = FALSEWORK_BEAMS.map((entry) => entry.id)
const PROP_IDS = PROP_TYPES.map((entry) => entry.id)

const PART_PATCH = z.object({
  systemId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(`panel system for wall and column forms; one of: ${SYSTEM_IDS.join(', ')}`),
  sheathingId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(`face material — ply or panel formlining; one of: ${SHEATHING_IDS.join(', ')}`),
  beamId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(
      `the section used for studs, walers, joists and bearers alike; one of: ${BEAM_IDS.join(', ')}`,
    ),
  propId: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe(`one of: ${PROP_IDS.join(', ')}`),
  doubledWalers: z
    .boolean()
    .nullable()
    .optional()
    .describe('walers paired either side of the tie, which usually opens the tie spacing'),
})

/**
 * Every catalog id a part could legitimately be substituted for.
 *
 * One flat set rather than a per-kind list, because the check is only "does this name
 * a real product" — whether a beam is a sensible stand-in for a beam is the
 * substitution list the panel offers, and a tighter check here would reject the
 * legitimate case where a column form stands in for a wall panel on a blade.
 */
const CATALOG_IDS = new Set<string>(STOCKABLE_CATALOG_PARTS.map((part) => part.id))

/**
 * What the yard owns, keyed by catalog id.
 *
 * A record rather than a fixed shape because the keys are the catalog, and it is the
 * one settings group where the model supplies the field names. Validated against
 * `CATALOG_IDS` on the way in for a sharper reason than the part ids are: an id that
 * names nothing can never be matched by a bill line, so "we own 200 of those" would be
 * accepted, stored, and silently make no difference to a single quantity.
 */
const STOCK_PATCH = z.record(
  z.string().max(120),
  z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe('how many the yard owns; 0 means owns none of this type, null removes the entry'),
)

/**
 * What the project pays for one catalog part.
 *
 * Three fields rather than a `basis` enum, because the basis is a property of the line
 * and not of the part: `bomSupply` has already decided which of a panel type's 26 are
 * hired and which are spent, and a model stating `basis: 'purchase'` against a panel the
 * bill hires would be a second answer to a settled question. So a part carries what it
 * is worth and what it costs to hold, and the bill decides which applies — a hired panel
 * drilled for this pour needs both.
 */
const PART_RATE_PATCH = z.object({
  purchasePerUnit: z
    .number()
    .positive()
    .max(10_000_000)
    .nullable()
    .optional()
    .describe(
      'list price of one, new. Also what an altered hired part is recharged at, and what the hire percentage is a percentage of',
    ),
  rentalPercentPerMonth: z
    .number()
    .positive()
    .max(100)
    .nullable()
    .optional()
    .describe(
      'hire as a percentage of new value per month — how the trade quotes it, usually 2–4 %. Needs purchasePerUnit to resolve to money',
    ),
  rentalPerUnitPerMonth: z
    .number()
    .positive()
    .max(1_000_000)
    .nullable()
    .optional()
    .describe(
      'a flat hire quote per unit per month. Overrides the percentage where both are stated, because an actual quote beats a rule of thumb applied to a list price',
    ),
  expectedUses: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .nullable()
    .optional()
    .describe(
      'how many fittings this part is expected to give before it is replaced. With purchasePerUnit this charges the yard’s own stock at a cost per use — amortisation — instead of at an internal hire rate, which is what the owned figure falls back to without it. Ask the user: a life in uses is a judgement about how hard this yard works its plant, and it is not the reuse figure on the set count, which is how many times this one job fits a part',
    ),
  residualPerUnit: z
    .number()
    .nonnegative()
    .max(10_000_000)
    .nullable()
    .optional()
    .describe(
      'what one is worth at the end of that life, in the same money as purchasePerUnit. Leave it out where nothing is recovered, which is the usual case for ply; state it for steel frames, where the scrap value is real and charging the whole list price over the uses overstates every job the panel was on',
    ),
})

/**
 * The rate table, keyed by catalog id like the rack.
 *
 * Validated against `CATALOG_IDS` for the same reason the rack is, and with the same
 * consequence: a rate against an id that names nothing can never be matched by a bill
 * line, so it would be accepted, stored, and price exactly nothing.
 */
const RATES_PATCH = z.object({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional()
    .describe('ISO 4217, e.g. GBP — so no figure is ever reported as a bare number'),
  minHireDays: z
    .number()
    .int()
    .positive()
    .max(3650)
    .nullable()
    .optional()
    .describe(
      "the agreement's minimum hire period, days. On a fast cycle this is most of the cost: a wall form struck in 12 hours against a 28-day minimum is charged for 28 days",
    ),
  gangRatePerHour: z
    .number()
    .positive()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "the all-in cost of one man-hour of the forming gang — what turns the labour norms into money. On its own it prices nothing: the hours come from labourNorms, and a rate with no norms recorded leaves the takeoff with no labour at all rather than a rate applied to an output nobody stated. All-in means the crew's cost to the job, not a bare wage",
    ),
  transportPerLoad: z
    .number()
    .positive()
    .max(1_000_000)
    .nullable()
    .optional()
    .describe(
      'what one delivery load costs, one way — the charge a haulier makes for a lorry. Per load rather than per tonne or per mile, because that is how the trade quotes it and because the distance is already inside the figure the haulier gave. On its own it prices nothing: the number of loads comes from logistics.lorryPayloadKg against the weight of the bill',
    ),
  cranePerHour: z
    .number()
    .positive()
    .max(1_000_000)
    .nullable()
    .optional()
    .describe(
      'the hourly rate of the crane the job hires, all-in with its operator and slinger. State this only where a crane is hired by the hour: a tower crane standing over the pour is a preliminary charged by the week whether it lifts this formwork or not, and pricing hook time against one charges the same crane twice. Needs logistics.minutesPerPick to become money',
    ),
  byCatalogId: z
    .record(z.string().max(120), PART_RATE_PATCH.nullable())
    .optional()
    .describe(
      'rate per catalog id. Merged into what is recorded, so pass only the parts you are changing; a field set to null clears that field and null against a whole id removes it',
    ),
})

/**
 * What a lorry carries and how long a pick takes — the two quantities behind the two
 * costs every total in this model has excluded.
 *
 * Separate from the rates that price them for the reason the norms are separate from the
 * gang rate: these are facts about the job's own plant and the rates are money, and the
 * money is stated once with the currency it is in. A project may state either half — a
 * payload with no charge counts the loads and does not price them, which is a useful
 * answer to a yard arranging its own haulage.
 */
const LOGISTICS_PATCH = z.object({
  lorryPayloadKg: z
    .number()
    .positive()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      'what one lorry carries, kg — the payload the loads are counted against. Ask the user rather than assuming a vehicle: 8 t on a rigid, 24 t on an artic, and less again where the site gate or the crane at the far end decides it. The weight of the bill over this, rounded up, is the loads — so 8.2 t on an 8 t lorry is two, and the second one costs what the first did',
    ),
  minutesPerPick: z
    .number()
    .positive()
    .max(600)
    .nullable()
    .optional()
    .describe(
      'minutes of hook time one pick takes — sling, lift, land, release and hook back. The whole cycle rather than the lift: a crane is booked by the hour and the two minutes a gang spends in the air are the smallest part of the twenty it occupies. A fact about this crew on this crane, so ask for it',
    ),
  returnLoadFraction: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe(
      'the share of the outbound loads that come back, 0 to 1. Absent means all of them, which is what a returnable bill does. State a fraction where the formwork is largely consumed — a job of cut ply and site-made soldiers sends lorries out and brings a few back, and charging a return leg for each one doubles a real invoice',
    ),
})

/** The sheet sizes a nest may open, listed so a model states one that has dimensions. */
const SHEET_STOCK_IDS = SHEET_STOCK.map((entry) => entry.id)

/**
 * Where a lift joint may land — the one structural group the split and the validator
 * both read.
 *
 * Unlike the commercial groups beside it this is not "ask the user, never assume": it
 * is project data the way the rise rate is, and the reason it is still undefaulted is
 * sharper. A default of "anywhere" is what an unconfigured project already gets from
 * the solver's own uniform split, and resolving it would make the conflict that this
 * group exists to report impossible — the solver would always be on a permitted joint
 * by construction.
 */
const POURS_PATCH = z.object({
  permittedJointElevations: z
    .array(z.number().finite().positive().max(200))
    .nullable()
    .optional()
    .describe(
      'elevations a lift joint is allowed to land on, in metres above each element’s base — the undersides of slabs and beams, the tops of slabs, and storey breaks at the storey height. Cuts snap to the nearest one within jointSnapTolerance; where the stated set can satisfy no boundary the split reports a conflict rather than quietly placing a joint where none is permitted. Ask the engineer for these rather than inferring them from the lift cap: a wall capped at 3 m lifts is not permitted a joint at every 3 m',
    ),
  jointSnapTolerance: z
    .number()
    .finite()
    .positive()
    .max(10)
    .nullable()
    .optional()
    .describe(
      'how far a lift joint may move to reach a permitted elevation, in metres. Absent means 0.3 m, which is the strip below a slab soffit that is too shallow to form or vibrate',
    ),
  alternateBays: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'whether the bays are cast alternately — no two adjacent bays of an element share a pour interval, so the sequence orders one parity of bays before the other and reports which. The default practice is odd-numbered bays first with the even ones as infill; where the stated pour dates decide otherwise, the dates win. An element can override this per element with its own alternateBays',
    ),
})

/**
 * The sheets the ply comes out of, and what is worth racking off them.
 *
 * The one group whose ids are *not* the general catalog, and the reason is the failure it
 * prevents. `parts.sheathingId` names a sheathing grade and every sheathing id passes the
 * stockable-catalog check, so a model reaching for the id it already knows would state
 * `film-faced-ply-18` here, have it accepted, and produce no cut list at all — a grade has
 * no width and no length, and a nest cannot open one. So this is checked against sheet stock
 * alone, and the refusal says which list to pick from.
 */
/**
 * How fast the concrete can arrive — the third limit on a rise rate.
 *
 * Two fields rather than one because they are two constraints in series: a plant sending 40
 * behind a pump placing 15 delivers 15, and a model told to record "15" cannot say whether
 * the remedy is a supplier or a bigger pump.
 */
const CONCRETE_SUPPLY_PATCH = z.object({
  batchPlantOutputM3PerHour: z
    .number()
    .finite()
    .positive()
    .max(500)
    .nullable()
    .optional()
    .describe(
      'what the batching plant sustains for this job, m³/h — the booking rather than the plant’s peak rating. Ask the user: this is an arrangement with a supplier and there is nothing to infer it from',
    ),
  pumpRateM3PerHour: z
    .number()
    .finite()
    .positive()
    .max(500)
    .nullable()
    .optional()
    .describe(
      'what the placing end manages, m³/h — the pump, or the crane and skip. State it where placing is the narrower of the two, which on a column or a wall poured by skip it usually is. Not the same figure as placement.riseRateMH: that is metres of height per hour and this is cubic metres of concrete per hour, and the plan area is what turns one into the other',
    ),
})

const SHEETS_PATCH = z.object({
  stockIds: z
    .array(z.string().max(120))
    .max(20)
    .nullable()
    .optional()
    .describe(
      `sheet sizes the yard buys, in preference order; each one of: ${SHEET_STOCK_IDS.join(', ')}. Not the same field as parts.sheathingId, which is the face grade and carries no size — a nest needs a width and a length, and only these ids have them. A preference rather than a filter: a board too wide for the first is nested out of a later one instead of being refused, so state every size the yard genuinely stocks. Ask the user rather than assuming a merchant — 1220 × 2440 and 1250 × 2500 turn the same wall into different sheet counts`,
    ),
  minKeepWidthMm: z
    .number()
    .positive()
    .max(5000)
    .nullable()
    .optional()
    .describe(
      'narrowest offcut the yard racks, mm — below this it is scrap whatever its length. A policy about this yard and its storage rather than a fact about ply, so ask for it. Unstated keeps nothing, which is why a cut list reports offcuts as scrap until somebody states a threshold',
    ),
  minKeepLengthMm: z
    .number()
    .positive()
    .max(5000)
    .nullable()
    .optional()
    .describe('shortest offcut the yard racks, mm'),
  minKeepAreaM2: z
    .number()
    .positive()
    .max(50)
    .nullable()
    .optional()
    .describe(
      'smallest offcut worth racking by area, m² — an alternative to the two dimensions for a yard that thinks in "anything over a quarter sheet". Any one threshold met keeps the offcut',
    ),
  edgeTrimMm: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe(
      'material skimmed off each of a sheet’s four edges before nesting, mm — typically 0 or 10. A delivered edge is neither square nor sound, so a yard that cares about the joint line squares all four first; 10 a side takes a 1220 × 2440 sheet to 1200 × 2420, which is one 300 mm board fewer across it. Reserved on the nest rather than deducted from the count, and a board that fits the delivered sheet but not the squared one is refused rather than nested on material the saw has removed',
    ),
  handlingWasteFraction: z
    .number()
    .min(0)
    .max(0.5)
    .nullable()
    .optional()
    .describe(
      'sheets lost to damage, mis-cuts and spoiling, as a fraction of the nested count — typically 0.05 to 0.10. Stated separately from the cutting waste the nest computes because only one of the two is anybody’s to reduce: a geometric offcut is a layout problem and a broken corner is not, and one combined figure hides which. Applied to the sheet count and rounded up per sheet size, because a third of a sheet cannot be ordered',
    ),
})

/**
 * How long this project's gang takes, per kind of part.
 *
 * Keyed by part kind rather than by catalog id, which is the difference from the rate
 * table beside it and the reason the group exists at all: a price is a fact about a
 * product and an output is a fact about an *operation*. Fitting a 0.6 m panel and fitting
 * a 0.9 m one is the same work to a carpenter, and a table keyed by id would ask for
 * forty rows where five would do — and would leave every id nobody filled in silently
 * unnormed.
 *
 * The bounds are per *one part fitted once*, which is why the ceiling is 100 hours rather
 * than something larger: anything above that is a figure somebody has entered per m² or
 * per pour by mistake, and it would multiply by a bill quantity into a programme nobody
 * would question.
 */
const LABOUR_NORM_PATCH = z.object({
  erectHours: z
    .number()
    .positive()
    .max(100)
    .nullable()
    .optional()
    .describe('man-hours to fit one of these, once'),
  strikeHours: z
    .number()
    .positive()
    .max(100)
    .nullable()
    .optional()
    .describe(
      'man-hours to strike one. Not the erect halved and not the erect reversed: they are different operations weeks apart, and on a tie the strike is the longer of the two — a spanner going on, a cut rod and a made-good face coming off',
    ),
})

const LABOUR_NORMS_PATCH = z
  .record(
    z.enum([
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
    ]),
    LABOUR_NORM_PATCH.nullable(),
  )
  .describe(
    'man-hours per part kind. Merged into what is recorded, so pass only the kinds you are changing; a field set to null clears it and null against a kind removes the row',
  )

/**
 * The whole write, as a tool's input shape.
 *
 * A raw shape rather than a `z.object` so an MCP `inputSchema` can take it directly
 * and the AI SDK's `tool()` can wrap it, without either surface restating a field.
 */
export const formworkSettingsPatchInput = {
  pressureStandard: z
    .enum(['ACI_347', 'DIN_18218', 'CIRIA_108', 'BS_5975_SHORTCUT'])
    .nullable()
    .optional()
    .describe(
      'which code derives the fresh-concrete pressure. Follows the contract and the engineer of record — the catalog panels publish their permissible pressures against DIN, and a rating certified under one standard is not a check against another',
    ),
  measurementStandard: z
    .enum(['IS_1200_5', 'NRM2', 'HKSMM4', 'CESMM4', 'POMI'])
    .nullable()
    .optional()
    .describe("the contract's quantity rules — what the client actually pays for"),
  concrete: CONCRETE_PATCH.optional(),
  cement: CEMENT_PATCH.optional().describe(
    'the binder, asked as what it is rather than as the coefficient it implies',
  ),
  placement: PLACEMENT_PATCH.optional(),
  curing: CURING_PATCH.optional().describe(
    'what happens after the pour, which decides when the form comes off and therefore how long every hired part is held. Its temperature is the curing surface, not the placing temperature in placement. The group also carries the strength-based striking criterion: maturityTargetDegreeHours is the concrete’s maturity target in degree-hours at which the form may come off — a project decision you must ask for, never default, because a guessed target makes the strength check one that cannot fail — with the Nurse–Saul datum and the required strength it corresponds to (a fraction of the design strength, with the design strength in MPa) as the same criterion named as a contract would. A criterion missing the temperature history it accumulates over falls back to elapsed time and says so',
  ),
  schedule: SCHEDULE_PATCH.optional().describe(
    'the two lead times that turn a pour date into a delivery date: how long before a pour the plant is wanted on site, and how long after striking before it is back with the hire company. The pour dates themselves are per shutter and set with set_pour_date, because a wall cast in three lifts is three pours on three days',
  ),
  crane: CRANE_PATCH.optional().describe(
    "the site's own crane — its load chart, the height under the hook, the widest gang that can be moved and the minimum sling angle. Ask the user for the chart and never infer it from a rating: capacity falls along the jib, so the headline figure applies where nothing is ever built. Until this is recorded each face is grouped as one gang and no gang is checked against a lift at all, which is the honest answer — there is no conservative default crane, and a shipped curve would fail gangs the site lifts daily while passing gangs that never leave the ground",
  ),
  falseworkLoads: FALSEWORK_LOAD_PATCH.optional().describe(
    "what a soffit carries beyond the concrete itself; each is raised to ACI §2.2.1's floor",
  ),
  bracing: BRACING_PATCH.optional().describe(
    'wall forms are braced against wind and impact, not against the concrete — the ties do that',
  ),
  parts: PART_PATCH.optional().describe(
    'the catalog parts the design resolves against, which decide what every solved spacing is a spacing of',
  ),
  ownedStock: STOCK_PATCH.optional().describe(
    'how many of each catalog id the yard owns, keyed by id — a bill draws on these before it hires. Merged into what is already recorded, so pass only the types you are changing; null against an id removes it. Until a project records this, the takeoff reports no owned/hired split at all rather than putting the whole bill on hire',
  ),
  rates: RATES_PATCH.optional().describe(
    'what this project pays per catalog part, and the terms that apply across them. This is the one input in the whole formwork model that no code publishes and no product carries, so ask the user for it and never infer it: there is no conservative default to fall back to, and a project that has recorded nothing gets no money on its takeoff at all rather than a plausible figure. It is recorded on the project rather than on the catalog because a price is a commercial fact about this job — the same panel is different money to two yards in the same city, and different money again next quarter',
  ),
  logistics: LOGISTICS_PATCH.optional().describe(
    'what one lorry carries and how long a pick takes — the two quantities that turn a bill into deliveries and a lifting schedule into crane hours. These are the last two costs this model has excluded from every total it prints, and both figures are facts about the job’s own plant rather than about a product, so ask the user for them: a payload is the lorry the yard actually sends and a cycle time is this crew on this crane. Until they are recorded the takeoff carries no transport and no craneage at all. Needs rates.transportPerLoad and rates.cranePerHour to become money',
  ),
  sheets: SHEETS_PATCH.optional().describe(
    'the sheet stock the yard buys its ply out of, plus what it skims off each edge, what it racks the remainder of and what it loses to handling — what turns the cut boards already on the bill into sheets somebody orders. Ask the user for the sizes and never infer them from parts.sheathingId: that is the face grade and a grade has no dimensions, so a sheathing id stated here is refused. Until this is recorded there is no cut list at all, which is the honest answer — nesting against every sheet in the catalog would answer for a merchant rather than for this job and report a count nobody can fill. The sheets are a purchasing figure beside the bill rather than a line in it: the boards are already billed as cut ply, so the sheets are the same material counted a second way and are in no weight, no owned/hired split and no cost',
  ),
  concreteSupply: CONCRETE_SUPPLY_PATCH.optional().describe(
    'how fast the concrete can actually arrive — the batching plant’s output and the placing rate, m³/h. The third limit on a rate of rise, beside the rate the project states in placement and the pressure the panels are rated for: a 6 m² pour stated at 2 m/h wants 12 m³/h, and a plant sending 8 makes it 1.33 whatever the programme says. Ask the user for both; a supply figure you invent reports every small pour as starved or every large one as fed. Until this is recorded the supply is not checked at all, and the stated rate is designed to as if the concrete were unlimited',
  ),
  pours: POURS_PATCH.optional().describe(
    'where a lift joint may land — the permitted joint elevations above each element’s base (slab soffits, slab tops, storey breaks) and how far a cut may move to reach one. What the pour split snaps to and what the off-permitted check verifies against. Ask the engineer for the elevations rather than inferring them from the lift cap. Until this is recorded the split is the solver’s own, with every boundary labelled solver-chosen rather than as a project decision, and the conflict "no permitted joint satisfies the limits" cannot be reported',
  ),
  labourNorms: LABOUR_NORMS_PATCH.optional().describe(
    "how long this project's own gang takes to erect and to strike one of each kind of part, in man-hours. Ask the user for these and never supply them: published constants do exist — CPWD's Analysis of Rates, Spon's, RSMeans — and none of them can be used here, because they are per m² of a whole trade operation that already contains the panels, the backing, the ties and the strike, so spreading one over a bill of parts charges the same work several times over. An output norm is also a fact about a crew rather than about a product or a code: the same gang on its tenth identical floor beats its own figure from the first, so there is nothing conservative to fall back to. Until this is recorded the takeoff carries no labour at all, which is the honest answer and is why every cost figure in this model says labour is outside it. A kind you leave out is reported as uncovered fittings rather than costed at zero. Needs rates.gangRatePerHour to become money",
  ),
}

export const FormworkSettingsPatch = z.object(formworkSettingsPatchInput)
export type FormworkSettingsPatch = z.infer<typeof FormworkSettingsPatch>

/** The description every surface's write tool carries, so the guidance cannot diverge either. */
export const SET_FORMWORK_SETTINGS_DESCRIPTION =
  'Set the project pour settings — the inputs every shutter in the scene is designed against. These are project decisions, not per-element ones: the concrete arrives from one plant at one temperature and rises at a rate the pump sets, and the design code follows the contract. Pass only the groups you are changing, and only the fields within them. Pass null for a field to hand it back to the conservative shipped default. These re-design every shutter in the scene the next time it is solved, so you do not need to call attach_formwork afterwards — inspect_formwork_parts and the design report already read the new pour. What they do not change is how many shutters an element has: that is set_pour_limits. Ask the engineer for these figures rather than guessing — the rate of rise, the concrete temperature and the pressure code are the three inputs the whole design hangs off. Eight of the groups are commercial or site facts rather than structural and behave differently: ownedStock, rates, labourNorms, schedule, crane, logistics, sheets and concreteSupply are never assumed, so leave them absent unless the user gives you figures. A rate you invent becomes a price on a takeoff someone quotes, a lead time you invent becomes a delivery date somebody books against, an output norm you invent becomes a programme a gang is held to, a crane capacity you invent becomes a lift somebody signs off, a lorry payload you invent becomes a delivery count somebody books haulage against, and a sheet size you invent becomes a ply order cut to a size the merchant does not sell. labourNorms is the one to be most careful with, because published labour constants exist and none of them fits: they are per m² of a whole trade operation, and an output is a fact about a crew rather than about a product. The schedule group holds only the two lead times; the pour dates they are measured from belong to the shutters and are set with set_pour_date. The logistics group is quantities and the money for them is in rates: a payload and a cycle time there, transportPerLoad and cranePerHour here, and neither half prices anything without the other. concreteSupply is the newest and is not a cost at all: it is how fast the concrete arrives, in m³/h, and it is what decides whether the rate of rise in placement is a rate this pour can actually achieve — do not confuse the two, because a rate of rise is metres of height per hour and a supply is cubic metres of concrete per hour, and the pour’s plan area is what turns one into the other. pours is the one structural member of that set and works the same way: where a lift joint may land — the permitted elevations and the snap tolerance — is a decision about the building rather than about a price, but it is still never assumed, because a shipped default of "anywhere" would make the conflict this group exists to report impossible to reach. Leave it absent unless the engineer gives you the elevations. pours.alternateBays is the group’s second member and a different kind of statement: it says the bays are cast alternately — no two adjacent bays in one pour interval — and the sequence orders one parity before the other and reports which. It is a statement about the method of construction rather than a figure, so a project either builds this way or it does not; ask rather than assuming it, because the ordering it adds reaches every pour’s float.'

/** The description every surface's read tool carries. */
export const INSPECT_FORMWORK_SETTINGS_DESCRIPTION =
  'The project pour settings every shutter in the scene is designed against, and — for each figure — whether the project stated it or the engine assumed it. Read this before quoting any pressure or spacing: a design report figure derived from an assumed 7 m/h rate of rise at 20 °C is not the same claim as one the job actually stated. It also reports two commercial groups that are not design inputs: ownedStock, what the yard owns by catalog id, which is what the takeoff splits owned from hired against; and rates, what the project pays per catalog id plus its currency and minimum hire period, which is what a cost is derived from. Null against either means nobody has recorded it — not a yard that owns nothing and not a job that costs nothing. Read rates before quoting any figure from inspect_project_formwork as a price: where it is null there is no money in the takeoff at all, and where it is partial the total is a floor. Two more groups behave the same way. schedule, the two lead times between a pour date and a delivery date, is null until somebody records it, and while it is null a takeoff shows plant free the day it is struck and no delivery date at all. labour is this project’s own output norms — man-hours to erect and to strike one of each kind of part — and while it is null the takeoff carries no labour at all, which is why every cost figure in this model says labour is outside it and is normally the largest thing that is. Its gang rate lives in rates.gangRatePerHour, so norms without that rate are hours with no money and a rate without norms prices nothing. crane is the fifth: the site’s load chart as capacity against radius, plus the height under the hook, the widest gang that can be moved and the minimum sling angle. While it is null every face is grouped as one gang and no gang is checked against a lift, so a pick weight in the takeoff is a figure and not a verdict. Read the curve before saying a gang lifts — capacity falls along the jib, and the figure that governs is the one at the radius the gang is actually set at. logistics is the sixth: what one lorry carries, how long one pick takes and what fraction of the loads come back. While it is null the takeoff carries no transport and no craneage — the two costs every total in this model has excluded from the day it could print one. Its money is in rates.transportPerLoad and rates.cranePerHour, so a payload without a charge per load counts lorries and prices none of them. sheets is the seventh: the sheet stock the ply is nested out of, the thresholds for racking an offcut, and the handling waste. While it is null the takeoff carries no cut list — the sheet count for the cut boards on its own bill — because a sheathing grade has no size and nesting against the whole catalog would answer for a merchant rather than for this job. When it is stated, read the sheet count as a purchasing figure beside the bill and never add it to one: the boards are already billed as cut ply, so the sheets are that same material counted a second way and are in no weight, no owned/hired split and no cost. concreteSupply is the eighth: the batching plant’s output and the placing rate, m³/h. Read it before quoting any pressure or spacing as what this pour produces, because it is the one group that can contradict another: where the supply is slower than the stated rate of rise, the pour rises at the supply’s rate and the form is designed for a pressure it never sees. While it is null nothing is checked and the stated rate is designed to as if the concrete were unlimited, which is the conservative direction and still not what will happen on the day. pours is the ninth and the one structural member of the set: the permitted lift-joint elevations and the snap tolerance, which is what the split snaps to and what the off-permitted check verifies against. While it is null every split boundary is the solver’s own and is labelled solver-chosen rather than as a project decision; when it is stated, read a boundary that lands on none of the permitted elevations as the conflict the solution names, with the lift cap and the permitted set beside it — not as a design that was met. The group’s other member, alternateBays, states the bays are cast alternately; where it is set the sequence reads a bay order off it and reports the parity used, and where it is null adjacent bays are unordered unless the elements’ own alternateBays says so. One settings record per scene, so this takes no arguments.'

/** The first stock id that names nothing in the catalog, as the error a model reads back. */
function unknownStockId(patch: Readonly<Record<string, unknown>>): string | undefined {
  for (const catalogId of Object.keys(patch)) {
    if (!CATALOG_IDS.has(catalogId)) {
      return `Error: no catalog id "${catalogId}" — a stock entry that matches no part would be stored and change nothing. Read inspect_project_formwork for the ids this job's bill actually uses.`
    }
  }
  return undefined
}

/**
 * The first rate that names nothing in the catalog, or that resolves to no money.
 *
 * The second check is the one worth having. A percentage of new value with no new value
 * recorded is not a rate — it is a rate for a figure the project has not stated — and it
 * would be stored, reported as recorded, and price nothing. Refused rather than accepted
 * with a gap, because a model that has just been told "ok" will tell the user the hire
 * rate is set.
 */
function unknownRate(
  patch: NonNullable<FormworkSettingsPatch['rates']>,
  current: FormworkProjectSettingsNode['rates'],
): string | undefined {
  for (const [catalogId, rate] of Object.entries(patch.byCatalogId ?? {})) {
    if (!CATALOG_IDS.has(catalogId)) {
      return `Error: no catalog id "${catalogId}" — a rate against a part no bill line carries would be stored and price nothing. Read inspect_project_formwork for the ids this job's bill actually uses.`
    }
    if (rate === null) continue
    // Against the merged result, not the patch alone: adding a percentage to a part whose
    // list price is already recorded is the ordinary way this table gets filled in, and
    // refusing it would make the two fields impossible to state in either order.
    const recorded = current?.byCatalogId?.[catalogId]
    const purchase =
      rate.purchasePerUnit === undefined
        ? recorded?.purchasePerUnit
        : (rate.purchasePerUnit ?? null)
    const flat =
      rate.rentalPerUnitPerMonth === undefined
        ? recorded?.rentalPerUnitPerMonth
        : (rate.rentalPerUnitPerMonth ?? null)
    if (rate.rentalPercentPerMonth != null && flat == null && purchase == null) {
      return `Error: "${catalogId}" has a hire percentage but no purchasePerUnit for it to be a percentage of, so it would price nothing. State the list price too, or give rentalPerUnitPerMonth as a flat rate.`
    }
  }
  return undefined
}

/**
 * What is wrong with a stated load chart, in the words a model reads back.
 *
 * Two checks, and both are for transcription errors rather than for physics. Two rows at
 * the same radius are two answers to one question with no rule for which wins. A capacity
 * that *rises* with radius is a chart entered with its columns swapped — no crane lifts
 * more further out — and it is the error worth refusing hardest, because the swapped
 * chart is plausible, is stored, and reports every gang on the job as liftable.
 */
function unknownCrane(patch: NonNullable<FormworkSettingsPatch['crane']>): string | undefined {
  const curve = patch.capacityCurve
  if (curve == null) return undefined
  if (curve.length === 0) {
    return 'Error: an empty capacity curve is not a crane with no capacity — pass null to remove the chart, or the rows off the published one to record it.'
  }
  const sorted = [...curve].sort((a, b) => a.radiusM - b.radiusM)
  for (let index = 1; index < sorted.length; index++) {
    const under = sorted[index - 1] as CraneCapacityPoint
    const over = sorted[index] as CraneCapacityPoint
    if (over.radiusM === under.radiusM) {
      return `Error: two rows at ${over.radiusM} m (${under.capacityKg} kg and ${over.capacityKg} kg) — a chart cannot give one radius two capacities.`
    }
    if (over.capacityKg > under.capacityKg) {
      return `Error: the chart lifts ${over.capacityKg} kg at ${over.radiusM} m and only ${under.capacityKg} kg at ${under.radiusM} m. No crane lifts more further out — the radius and capacity columns are the wrong way round.`
    }
  }
  return undefined
}

/**
 * The first stated sheet id that is not a sheet, as the error a model reads back.
 *
 * Checked against `SHEET_STOCK` and deliberately not against `CATALOG_IDS`, which would
 * accept it: sheet stock and sheathing grades are both in the stockable catalog, because a
 * yard buys and racks both. The distinction that matters here is dimensional rather than
 * commercial — a grade has no width and no length — so a `film-faced-ply-18` accepted here
 * would be stored, reported as recorded, and nest not one board.
 */
function unknownSheetId(patch: NonNullable<FormworkSettingsPatch['sheets']>): string | undefined {
  for (const id of patch.stockIds ?? []) {
    if (!SHEET_STOCK_IDS.includes(id)) {
      const grade = SHEATHING_IDS.includes(id)
      return grade
        ? `Error: "${id}" is a sheathing grade, not a sheet size — it carries permissible pressures and no width or length, so a nest cannot open one. That id belongs in parts.sheathingId. Pick a sheet size here: ${SHEET_STOCK_IDS.join(', ')}`
        : `Error: no sheet stock "${id}" in the catalog — a sheet size that resolves to nothing would be stored and nest no boards. Pick one of: ${SHEET_STOCK_IDS.join(', ')}`
    }
  }
  return undefined
}

/** The first part id that names nothing in the catalog. */
function unknownPartId(patch: NonNullable<FormworkSettingsPatch['parts']>): string | undefined {
  const checks: Array<[keyof typeof patch, readonly string[]]> = [
    ['systemId', SYSTEM_IDS],
    ['sheathingId', SHEATHING_IDS],
    ['beamId', BEAM_IDS],
    ['propId', PROP_IDS],
  ]
  for (const [key, ids] of checks) {
    const value = patch[key]
    if (typeof value === 'string' && !ids.includes(value)) {
      return `Error: no ${key} "${value}" in the catalog. Pick one of: ${ids.join(', ')}`
    }
  }
  return undefined
}

/**
 * `null` from a model means "unstate this", which the merge helpers spell as
 * `undefined`. An absent key means "leave it alone", so the two cannot be collapsed.
 */
function toPatch<T extends object>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    out[key] = value === null ? undefined : value
  }
  return out
}

export type FormworkSettingsPatchResult =
  | { error: string; writes?: undefined; changed?: undefined }
  | {
      error?: undefined
      /**
       * The fields to write to the settings node, where an explicitly-`undefined` value
       * means *delete the key* rather than store it holding undefined. Both write paths
       * already honour that — the store's `updateNode` deletes explicit-undefined keys
       * because an optional field's absence encodes a mode, and the chat tools mutate a
       * plain object the same way.
       */
      writes: Partial<FormworkProjectSettingsNode>
      /** The groups the call touched, for a reply that says what it reached. */
      changed: string[]
    }

/**
 * What a stated patch does to the settings node — the writes, or the refusal.
 *
 * Pure, and returning writes rather than performing them, because the surfaces that
 * call it disagree about *how* to write and must not disagree about *what*. The
 * refusals are values for the same reason: "no beamId peri-h20" is a sentence a model
 * has to read and act on, and a thrown error reaches it as a tool failure with no
 * catalog in it.
 *
 * `current` is the node as it stands, or `undefined` for a project that has never
 * stated anything. The merges are relative to it, so a caller that has just created
 * an empty node passes the empty node and gets the same answer.
 */
export function applyFormworkSettingsPatch(
  current: FormworkProjectSettingsNode | undefined,
  patch: FormworkSettingsPatch,
): FormworkSettingsPatchResult {
  const { cement, ownedStock, rates, labourNorms, ...groups } = patch
  const stated = Object.entries(groups).filter(([, value]) => value !== undefined)
  if (
    stated.length === 0 &&
    cement === undefined &&
    ownedStock === undefined &&
    rates === undefined &&
    labourNorms === undefined
  ) {
    return { error: 'Error: nothing to set — pass at least one field' }
  }
  if (groups.parts) {
    const bad = unknownPartId(groups.parts)
    if (bad) return { error: bad }
  }
  if (ownedStock) {
    const bad = unknownStockId(ownedStock)
    if (bad) return { error: bad }
  }
  if (rates) {
    const bad = unknownRate(rates, current?.rates)
    if (bad) return { error: bad }
  }
  if (groups.crane) {
    const bad = unknownCrane(groups.crane)
    if (bad) return { error: bad }
  }
  if (groups.sheets) {
    const bad = unknownSheetId(groups.sheets)
    if (bad) return { error: bad }
  }

  const base = (current ?? {}) as Partial<FormworkProjectSettingsNode>
  const writes: Record<string, unknown> = {}
  const changed: string[] = []

  for (const [key, value] of stated) {
    if (key === 'pressureStandard' || key === 'measurementStandard') {
      // A top-level enum: null unstates it the same way a group field's does.
      writes[key] = value === null ? undefined : value
      changed.push(key)
      continue
    }
    const group = key as FormworkSettingsGroup
    const fields = toPatch(value as object)
    if (group === 'concrete' && 'consistencyClass' in fields) {
      // `consistencyClassOf` reports SCC whenever `selfCompacting` is set, so the two
      // are one fact and the schema asks for it once. The flag is what the codes
      // actually branch on — ACI has no SCC provisions and reads only this — so an F
      // class left beside a stale flag would be ignored entirely.
      fields.selfCompacting = fields.consistencyClass === 'SCC' ? true : undefined
    }
    writes[group] = mergeFormworkSettingsGroup(base[group] as never, fields as never)
    changed.push(group)
  }

  if (cement !== undefined) {
    // Chained through `writes` rather than `base`, because one call may state the
    // binder and a sibling of it: a `concrete` patch in this same call has already
    // produced a merged value, and merging the binder onto the *original* concrete
    // would discard it.
    const concrete = 'concrete' in writes ? writes.concrete : base.concrete
    writes.concrete = mergeFormworkCement(concrete as never, toPatch(cement) as never)
    changed.push('cement')
  }

  if (ownedStock !== undefined) {
    // Its own helper rather than the group merge, which would replace the whole rack:
    // recording one panel type would forget every other type the yard owns. And no
    // `undefined` branch — an emptied rack stays stated, because a project that removed
    // every line has said it owns nothing.
    writes.stock = mergeFormworkOwnedStock(base.stock as never, toPatch(ownedStock) as never)
    changed.push('ownedStock')
  }

  if (rates !== undefined) {
    // Two levels like the rack, and one difference: a *field* of one id's rate can be
    // cleared without removing the id, because a list price and a hire term are entered
    // at different times and replacing the object would make filling in the second delete
    // the first. `stated` carries which of the two group-level fields this call named, so
    // an explicit null clears rather than being read as "left alone".
    const byCatalogId: Record<string, Record<string, number | undefined> | undefined> = {}
    for (const [catalogId, rate] of Object.entries(rates.byCatalogId ?? {})) {
      byCatalogId[catalogId] = rate === null ? undefined : (toPatch(rate) as never)
    }
    writes.rates = mergeFormworkRates(
      base.rates,
      {
        ...(rates.currency === undefined ? {} : { currency: rates.currency ?? undefined }),
        ...(rates.minHireDays === undefined ? {} : { minHireDays: rates.minHireDays ?? undefined }),
        ...(rates.gangRatePerHour === undefined
          ? {}
          : { gangRatePerHour: rates.gangRatePerHour ?? undefined }),
        ...(rates.transportPerLoad === undefined
          ? {}
          : { transportPerLoad: rates.transportPerLoad ?? undefined }),
        ...(rates.cranePerHour === undefined
          ? {}
          : { cranePerHour: rates.cranePerHour ?? undefined }),
        byCatalogId,
      },
      {
        currency: rates.currency !== undefined,
        minHireDays: rates.minHireDays !== undefined,
        gangRatePerHour: rates.gangRatePerHour !== undefined,
        transportPerLoad: rates.transportPerLoad !== undefined,
        cranePerHour: rates.cranePerHour !== undefined,
      },
    )
    changed.push('rates')
  }

  if (labourNorms !== undefined) {
    // Its own helper for the rate table's reason — the group merge would replace the whole
    // norm table, so stating the panel figure would forget every other kind — and one of its
    // own: a kind's two hours are entered by whoever knows that trade, at different times,
    // so a replace would make recording a strike time delete the erect time beside it.
    const byPartKind: Record<string, Record<string, number | undefined> | undefined> = {}
    for (const [kind, norm] of Object.entries(labourNorms)) {
      byPartKind[kind] = norm === null ? undefined : (toPatch(norm as object) as never)
    }
    writes.labour = mergeFormworkLabourNorms(base.labour, byPartKind)
    changed.push('labourNorms')
  }

  return { writes: writes as Partial<FormworkProjectSettingsNode>, changed }
}

/**
 * The pour as an agent should read it: the resolved figures, what the project actually
 * stated, and the defaults that filled the rest in.
 *
 * The three are separate keys rather than one merged view because that separation *is*
 * the answer. A tie spacing derived from an assumed 7 m/h at 20 °C and one derived from
 * a stated 2 m/h are the same number presented as two different claims, and a surface
 * that reports only the resolved figures gives a model no way to tell the user which it
 * is holding.
 */
export interface FormworkSettingsReport {
  /** False for a project that has never stated a single field. */
  anythingStated: boolean
  resolved: {
    pressureStandard: string
    measurementStandard: string
    riseRateMH: number
    concreteTemperatureC: number
    concrete: NonNullable<FormworkProjectSettingsNode['concrete']>
    placement: Record<string, unknown>
    curing: NonNullable<FormworkProjectSettingsNode['curing']>
    falseworkLoads: NonNullable<FormworkProjectSettingsNode['falseworkLoads']>
    bracing: NonNullable<FormworkProjectSettingsNode['bracing']>
    parts: NonNullable<FormworkProjectSettingsNode['parts']>
    /**
     * Null where the project has stated neither lead time, which is the answer that means
     * a programme carries no delivery date. Unlike every other group here there is no
     * default underneath it — see `SCHEDULE_PATCH`.
     */
    schedule: NonNullable<FormworkProjectSettingsNode['schedule']> | null
    /**
     * Null where no crane is recorded, which is the answer that means no gang has been
     * checked against a lift. There is no default underneath it for the reason there is
     * none under the rates: a shipped curve is a machine nobody hired.
     */
    crane: NonNullable<FormworkProjectSettingsNode['crane']> | null
    /**
     * Null rather than an empty rack, and the two are different answers: null is nobody
     * having said, so the takeoff shows no owned/hired split at all, where `{}` is a
     * yard that has recorded owning nothing.
     */
    ownedStock: Record<string, number> | null
    /**
     * Null for a project that has recorded no rates, which is the answer that means the
     * takeoff carries no money at all. An empty `byCatalogId` is the other answer: the
     * project opened the table and priced nothing.
     */
    rates: RateTable | null
    /**
     * Null where nobody has stated an output norm, which is the answer that means the
     * takeoff carries no hours at all. The gang rate travels inside it rather than beside
     * the other money, because hours and the rate that prices them are one answer.
     */
    labour: NormTable | null
    /**
     * Null where nobody has stated a payload or a cycle time, which is the answer that
     * means the takeoff carries no transport and no craneage — the two costs every total
     * in this model has excluded since the money arrived.
     */
    logistics: NonNullable<FormworkProjectSettingsNode['logistics']> | null
    /**
     * Null where no sheet stock is recorded, which is the answer that means the takeoff
     * carries no cut list. Not the same field as `parts.sheathingId`: that is the face
     * grade and carries no dimensions, and a nest needs a width and a length.
     */
    sheets: NonNullable<FormworkProjectSettingsNode['sheets']> | null
    /**
     * Null where no supply is recorded, which means the stated rate of rise is designed to
     * as if the concrete were unlimited — and the supply check reports itself unperformed
     * rather than passed.
     */
    concreteSupply: NonNullable<FormworkProjectSettingsNode['concreteSupply']> | null
    /**
     * Null where no permitted joint elevations are recorded, which is the answer that
     * means every split boundary is the solver's own — and labelled as such, never as a
     * project decision. The one structural member of the otherwise-commercial set, and
     * undefaulted for a sharper reason than the rest: a default of "anywhere" would make
     * the conflict this group exists to report impossible to reach.
     */
    pours: NonNullable<FormworkProjectSettingsNode['pours']> | null
  }
  /**
   * Only what the project actually said. Anything absent here but present in `resolved`
   * is the shipped conservative default, not a decision.
   */
  stated: {
    pressureStandard: string | null
    measurementStandard: string | null
    concrete: NonNullable<FormworkProjectSettingsNode['concrete']> | null
    placement: NonNullable<FormworkProjectSettingsNode['placement']> | null
    curing: NonNullable<FormworkProjectSettingsNode['curing']> | null
    falseworkLoads: NonNullable<FormworkProjectSettingsNode['falseworkLoads']> | null
    bracing: NonNullable<FormworkProjectSettingsNode['bracing']> | null
    parts: NonNullable<FormworkProjectSettingsNode['parts']> | null
    schedule: NonNullable<FormworkProjectSettingsNode['schedule']> | null
    crane: NonNullable<FormworkProjectSettingsNode['crane']> | null
    stock: NonNullable<FormworkProjectSettingsNode['stock']> | null
    rates: NonNullable<FormworkProjectSettingsNode['rates']> | null
    labour: NonNullable<FormworkProjectSettingsNode['labour']> | null
    logistics: NonNullable<FormworkProjectSettingsNode['logistics']> | null
    sheets: NonNullable<FormworkProjectSettingsNode['sheets']> | null
    concreteSupply: NonNullable<FormworkProjectSettingsNode['concreteSupply']> | null
    pours: NonNullable<FormworkProjectSettingsNode['pours']> | null
  } | null
  /**
   * The four figures the engine supplies when nobody has. There is no curing entry
   * here on purpose: the striking tables print their own conservative column and name
   * what they took in the takeoff's `hire.assumed`, so a default resolved here would
   * arrive indistinguishable from one the job stated.
   */
  assumedDefaults: {
    riseRateMH: number
    concreteTemperatureC: number
    pressureStandard: string
    measurementStandard: string
  }
}

export function formworkSettingsReport(
  node: FormworkProjectSettingsNode | undefined,
): FormworkSettingsReport {
  const resolved = formworkSettings(node)
  return {
    anythingStated: node !== undefined,
    resolved: {
      pressureStandard: resolved.pressureStandard,
      measurementStandard: resolved.measurementStandard,
      riseRateMH: resolved.riseRateMH,
      concreteTemperatureC: resolved.concreteTemperatureC,
      concrete: resolved.concrete,
      placement: resolved.placement as Record<string, unknown>,
      curing: resolved.curing,
      falseworkLoads: resolved.falseworkLoads,
      bracing: resolved.bracing,
      parts: resolved.parts,
      schedule: resolved.schedule ?? null,
      crane: resolved.crane ?? null,
      ownedStock: resolved.ownedStock ?? null,
      rates: resolved.rates ?? null,
      labour: resolved.labour ?? null,
      logistics: resolved.logistics ?? null,
      sheets: resolved.sheets ?? null,
      concreteSupply: resolved.concreteSupply ?? null,
      pours: resolved.pours ?? null,
    },
    stated: node
      ? {
          pressureStandard: node.pressureStandard ?? null,
          measurementStandard: node.measurementStandard ?? null,
          concrete: node.concrete ?? null,
          placement: node.placement ?? null,
          curing: node.curing ?? null,
          falseworkLoads: node.falseworkLoads ?? null,
          bracing: node.bracing ?? null,
          parts: node.parts ?? null,
          schedule: node.schedule ?? null,
          crane: node.crane ?? null,
          stock: node.stock ?? null,
          rates: node.rates ?? null,
          labour: node.labour ?? null,
          logistics: node.logistics ?? null,
          sheets: node.sheets ?? null,
          concreteSupply: node.concreteSupply ?? null,
          pours: node.pours ?? null,
        }
      : null,
    assumedDefaults: {
      riseRateMH: DEFAULT_FORMWORK_SETTINGS.riseRateMH,
      concreteTemperatureC: DEFAULT_FORMWORK_SETTINGS.concreteTemperatureC,
      pressureStandard: DEFAULT_FORMWORK_SETTINGS.pressureStandard,
      measurementStandard: DEFAULT_FORMWORK_SETTINGS.measurementStandard,
    },
  }
}
