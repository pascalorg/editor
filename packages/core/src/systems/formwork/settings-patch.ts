import { z } from 'zod'
import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import {
  FALSEWORK_BEAMS,
  FORMWORK_SYSTEMS,
  PROP_TYPES,
  SHEATHING_TYPES,
  STOCKABLE_CATALOG_PARTS,
} from './catalog'
import {
  DEFAULT_FORMWORK_SETTINGS,
  type FormworkSettingsGroup,
  formworkSettings,
  mergeFormworkCement,
  mergeFormworkOwnedStock,
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
    'what happens after the pour, which decides when the form comes off and therefore how long every hired part is held. Its temperature is the curing surface, not the placing temperature in placement',
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
}

export const FormworkSettingsPatch = z.object(formworkSettingsPatchInput)
export type FormworkSettingsPatch = z.infer<typeof FormworkSettingsPatch>

/** The description every surface's write tool carries, so the guidance cannot diverge either. */
export const SET_FORMWORK_SETTINGS_DESCRIPTION =
  'Set the project pour settings — the inputs every shutter in the scene is designed against. These are project decisions, not per-element ones: the concrete arrives from one plant at one temperature and rises at a rate the pump sets, and the design code follows the contract. Pass only the groups you are changing, and only the fields within them. Pass null for a field to hand it back to the conservative shipped default. These re-design every shutter in the scene the next time it is solved, so you do not need to call attach_formwork afterwards — inspect_formwork_parts and the design report already read the new pour. What they do not change is how many shutters an element has: that is set_pour_limits. Ask the engineer for these figures rather than guessing — the rate of rise, the concrete temperature and the pressure code are the three inputs the whole design hangs off.'

/** The description every surface's read tool carries. */
export const INSPECT_FORMWORK_SETTINGS_DESCRIPTION =
  'The project pour settings every shutter in the scene is designed against, and — for each figure — whether the project stated it or the engine assumed it. Read this before quoting any pressure or spacing: a design report figure derived from an assumed 7 m/h rate of rise at 20 °C is not the same claim as one the job actually stated. It also reports ownedStock, what the yard owns by catalog id, which is not a design input but is what the takeoff splits owned from hired against — null there means nobody has recorded a rack, which is not the same as a yard that owns nothing. One settings record per scene, so this takes no arguments.'

/** The first stock id that names nothing in the catalog, as the error a model reads back. */
function unknownStockId(patch: Readonly<Record<string, unknown>>): string | undefined {
  for (const catalogId of Object.keys(patch)) {
    if (!CATALOG_IDS.has(catalogId)) {
      return `Error: no catalog id "${catalogId}" — a stock entry that matches no part would be stored and change nothing. Read inspect_project_formwork for the ids this job's bill actually uses.`
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
  const { cement, ownedStock, ...groups } = patch
  const stated = Object.entries(groups).filter(([, value]) => value !== undefined)
  if (stated.length === 0 && cement === undefined && ownedStock === undefined) {
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
     * Null rather than an empty rack, and the two are different answers: null is nobody
     * having said, so the takeoff shows no owned/hired split at all, where `{}` is a
     * yard that has recorded owning nothing.
     */
    ownedStock: Record<string, number> | null
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
    stock: NonNullable<FormworkProjectSettingsNode['stock']> | null
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
      ownedStock: resolved.ownedStock ?? null,
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
          stock: node.stock ?? null,
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
