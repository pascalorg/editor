import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import type { AnyNode } from '../../schema/types'
import type { RateTable } from './cost'
import type { NormTable } from './labour'
import { DEFAULT_MEASUREMENT_STANDARD_ID, type MeasurementStandardId } from './measurement'
import {
  DEFAULT_PRESSURE_STANDARD_ID,
  DIN_MAX_RISE_RATE_MH,
  type Placement,
  type PressureStandardId,
} from './pressure'
import type { OwnedStock } from './supply'

/**
 * The project's pour settings, resolved — one place where "not stated" becomes a
 * number.
 *
 * Every design input the engine reads passes through here, and the reason is that
 * defaults are the part of this that goes wrong. A default duplicated at each
 * call site drifts: the wall chain designs to 2 m/h, the column schedule to 3,
 * and the two shutters either side of a junction are checked against different
 * pours while both panels look correct. So the fallback is written once, and
 * `formworkSettings` is the only way to obtain one.
 *
 * The pressure defaults are conservative rather than typical. Nothing in a scene
 * carries a rise rate until someone enters one, and at the fastest rate a code
 * covers an ordinary lift lands on or near the full fluid head — so an
 * unconfigured project is designed to something defensible, and a slower pour is
 * a saving the project claims by stating it. That is the right direction for a
 * default nobody has looked at.
 */

/** DIN's own reference temperature, so no correction is applied unasked. */
export const DEFAULT_CONCRETE_TEMPERATURE_C = 20

export interface FormworkSettings {
  pressureStandard: PressureStandardId
  measurementStandard: MeasurementStandardId
  riseRateMH: number
  concreteTemperatureC: number
  /**
   * What the project actually stated, for a report that wants to distinguish a
   * figure from an assumption. The design chain reads the resolved fields above
   * and never this: a decision taken here would be a second reading of the same
   * input. A project that deliberately states DIN's maximum rise rate is not
   * assuming it, and comparing against the default cannot tell the two apart.
   */
  stated: FormworkProjectSettingsNode | undefined
  /** The mix, as the pressure codes take it. Unstated fields keep each code's own default. */
  concrete: NonNullable<FormworkProjectSettingsNode['concrete']>
  /** How the pour is done, less the two fields each element supplies itself. */
  placement: Omit<Placement, 'pourHeightM' | 'elementKind' | 'riseRateMH' | 'concreteTemperatureC'>
  /**
   * How the concrete is cured, which is what the striking time is taken from.
   *
   * Unstated fields are left unstated rather than defaulted, unlike the pressure
   * inputs beside them, and the difference is that the striking tables default
   * themselves: BS 8110 prints a "16 °C and above" column and ACI a longest span
   * band, so `strikingTime` takes the table's own conservative end and names it in
   * `assumed`. A number resolved here would arrive at the same figure and lose the
   * only thing that distinguishes it from a project that stated it.
   */
  curing: NonNullable<FormworkProjectSettingsNode['curing']>
  falseworkLoads: NonNullable<FormworkProjectSettingsNode['falseworkLoads']>
  bracing: NonNullable<FormworkProjectSettingsNode['bracing']>
  parts: NonNullable<FormworkProjectSettingsNode['parts']>
  /**
   * What the yard owns, or `undefined` where nobody has said.
   *
   * The one resolved field that is deliberately *not* defaulted, against the rule
   * every other field here follows. A default of `{}` would be the claim "owns
   * nothing", and that is a claim with a consequence — the whole bill on hire — that
   * no unconfigured project has made. An empty record reaching here means the project
   * stated it, and a costing pass may act on it; `undefined` means the takeoff reports
   * no split at all. Same reasoning as the validator's `notChecked`: an answer nobody
   * supplied the input for is not an answer with a convenient value.
   */
  ownedStock: OwnedStock | undefined
  /**
   * What the project pays, or `undefined` where nobody has recorded a rate.
   *
   * Undefaulted for the same reason as `ownedStock`, and a sharper one. A rate is the
   * only input in this whole model that no code publishes and no product carries, so
   * there is nothing conservative to fall back to: a default of zero prices a job at
   * nothing and a default of anything else invents a price. So absent means the takeoff
   * carries no money at all, and the surfaces say so rather than showing a total.
   */
  rates: RateTable | undefined
  /**
   * How long this project's gang takes, or `undefined` where nobody has stated a norm.
   *
   * The fourth undefaulted field, and the one with the least behind it. A rate at least has
   * a market; an output norm is a fact about a *crew*, and the published constants are per
   * m² of a whole trade operation rather than per part, so there is no table to fall back
   * to even in principle. Absent means the takeoff carries no hours at all.
   *
   * The gang rate travels with the norms rather than with the money it is stated beside,
   * because hours and the rate that prices them are one answer: a rate with no norms
   * prices nothing, and norms with no rate are hours with no money — both of which this
   * says, and neither of which needs the rest of the rate table to be read.
   */
  labour: NormTable | undefined
  /**
   * How a pour date becomes the days the plant is on site, or `undefined`.
   *
   * The third undefaulted field, and for the rates' reason rather than the rack's: a
   * lead time has no published table behind it, so there is nothing conservative to
   * fall back to. A default of zero says the shutter appears on the morning of the
   * pour, which is the one answer that is certainly wrong, and any other default
   * invents this yard's way of working. So absent means the programme reports the
   * pour and the strike and stays quiet about the days either side.
   */
  schedule: NonNullable<FormworkProjectSettingsNode['schedule']> | undefined
  /**
   * The site's crane, or `undefined` where nobody has recorded one.
   *
   * The fifth undefaulted field, and the one where a default would do the most damage.
   * There is no conservative crane: a shipped curve set low fails gangs the site's actual
   * machine lifts every day, and one set high passes gangs that do not leave the ground.
   * Both read as a check that ran. So absent means each face is grouped as one gang and
   * the takeoff says no crane was stated — see `crane.ts`.
   */
  crane: NonNullable<FormworkProjectSettingsNode['crane']> | undefined
  /**
   * What a lorry carries and how long a pick takes, or `undefined`.
   *
   * The sixth undefaulted field, and the one whose absence has been on every surface of
   * this feature the longest: transport and craneage are what `cost.excludes` has named
   * since the money arrived. Both figures are facts about this job's own plant — a payload
   * is the lorry the yard sends and a cycle time is this crew on this crane — so there is
   * nothing to fall back to, and a default would put a delivery charge on a takeoff for
   * lorries nobody booked.
   */
  logistics: NonNullable<FormworkProjectSettingsNode['logistics']> | undefined
  /**
   * The sheets the ply is cut out of, or `undefined`.
   *
   * The seventh undefaulted field, and the only one whose absence hides an answer the model
   * could compute: every dimension the nest needs is already on the parts, and what is
   * missing is the *sheet* they come out of. `parts.sheathingId` cannot supply it — a
   * sheathing grade carries pressures and no size — and defaulting to the whole catalog
   * would nest each board out of whichever of seven sheets happened to suit it and report a
   * count no merchant can fill. So absent means no cut list, and the surfaces say which
   * fact is missing rather than showing a sheet count for sheets nobody buys.
   */
  sheets: NonNullable<FormworkProjectSettingsNode['sheets']> | undefined
  /**
   * How fast the concrete can arrive, or `undefined`.
   *
   * The eighth undefaulted field, and the one whose absence changes an answer rather than
   * withholding one: a rise rate has always been read as the project's decision, and this
   * is the fact that can contradict it. There is nothing conservative to fall back to in
   * either direction — a shipped output reports every small pour as starved and a generous
   * one reports a supply nobody booked — so absent means the supply check is not performed
   * and the surfaces say which figure is missing.
   */
  concreteSupply: NonNullable<FormworkProjectSettingsNode['concreteSupply']> | undefined
}

/**
 * What the engine designs to when the project has said nothing. Exported so a
 * report can name the figure it assumed rather than printing it unattributed —
 * a visible number the user cannot trace is worse than a hidden one.
 */
export const DEFAULT_FORMWORK_SETTINGS: FormworkSettings = {
  pressureStandard: DEFAULT_PRESSURE_STANDARD_ID,
  measurementStandard: DEFAULT_MEASUREMENT_STANDARD_ID,
  riseRateMH: DIN_MAX_RISE_RATE_MH,
  concreteTemperatureC: DEFAULT_CONCRETE_TEMPERATURE_C,
  stated: undefined,
  concrete: {},
  placement: { vibration: 'internal' },
  curing: {},
  falseworkLoads: {},
  bracing: {},
  parts: {},
  ownedStock: undefined,
  rates: undefined,
  labour: undefined,
  schedule: undefined,
  crane: undefined,
  logistics: undefined,
  sheets: undefined,
  concreteSupply: undefined,
}

/**
 * Resolves the settings node into the shape the design chain reads.
 *
 * Takes the node rather than the scene so it stays pure and so a caller that has
 * already found it does not pay for the search twice. `undefined` is the answer
 * for a scene that has never opened the dialog, and it resolves to the same
 * defaults an explicitly empty node does — the two are not distinguishable to
 * the engine, and should not be.
 */
export function formworkSettings(node: FormworkProjectSettingsNode | undefined): FormworkSettings {
  if (!node) return DEFAULT_FORMWORK_SETTINGS
  const placement = node.placement ?? {}
  return {
    stated: node,
    pressureStandard: node.pressureStandard ?? DEFAULT_FORMWORK_SETTINGS.pressureStandard,
    measurementStandard: node.measurementStandard ?? DEFAULT_FORMWORK_SETTINGS.measurementStandard,
    riseRateMH: placement.riseRateMH ?? DEFAULT_FORMWORK_SETTINGS.riseRateMH,
    concreteTemperatureC:
      placement.concreteTemperatureC ?? DEFAULT_FORMWORK_SETTINGS.concreteTemperatureC,
    concrete: node.concrete ?? {},
    placement: {
      vibration: placement.vibration ?? 'internal',
      ...(placement.vibratorImmersionDepthM !== undefined
        ? { vibratorImmersionDepthM: placement.vibratorImmersionDepthM }
        : {}),
      ...(placement.pumpedFromBase !== undefined
        ? { pumpedFromBase: placement.pumpedFromBase }
        : {}),
    },
    curing: node.curing ?? {},
    falseworkLoads: node.falseworkLoads ?? {},
    bracing: node.bracing ?? {},
    parts: node.parts ?? {},
    ownedStock: node.stock?.owned,
    // A stated group with an empty table resolves to an empty table rather than to
    // `undefined`, which keeps the same distinction the rack draws: a project that has
    // opened the rates and entered nothing gets a priced answer of nothing recorded,
    // where a project that has never opened them gets no money at all.
    rates: node.rates
      ? {
          ...(node.rates.currency === undefined ? {} : { currency: node.rates.currency }),
          ...(node.rates.minHireDays === undefined ? {} : { minHireDays: node.rates.minHireDays }),
          byCatalogId: node.rates.byCatalogId ?? {},
          ...(node.rates.transportPerLoad === undefined
            ? {}
            : { transportPerLoad: node.rates.transportPerLoad }),
          ...(node.rates.cranePerHour === undefined
            ? {}
            : { cranePerHour: node.rates.cranePerHour }),
        }
      : undefined,
    // Two stated groups joined into one resolved table, because hours and the rate that
    // prices them are one answer and a consumer holding only half of it would either
    // report hours it could not cost or reach back into the settings node for the rate.
    // The currency comes across for the same reason: a labour cost shown as a bare number
    // beside a hire charge in GBP is the failure `formatMoney` exists to prevent.
    labour: node.labour
      ? {
          byPartKind: node.labour.byPartKind ?? {},
          ...(node.rates?.gangRatePerHour === undefined
            ? {}
            : { gangRatePerHour: node.rates.gangRatePerHour }),
          ...(node.rates?.currency === undefined ? {} : { currency: node.rates.currency }),
        }
      : undefined,
    schedule: node.schedule,
    crane: node.crane,
    logistics: node.logistics,
    sheets: node.sheets,
    concreteSupply: node.concreteSupply,
  }
}

/**
 * The scene's settings node, or `undefined`.
 *
 * One per scene by construction: the dialog creates it on first write and there
 * is no way to make a second. Should a scene arrive with two — a merge, a paste
 * — the first wins rather than the last, so the answer is stable across reloads
 * whatever order the nodes come back in.
 */
export function findFormworkSettingsNode(
  nodes: Iterable<AnyNode>,
): FormworkProjectSettingsNode | undefined {
  for (const node of nodes) {
    if (node.type === 'formwork-settings') return node
  }
  return undefined
}

/** The scene's resolved settings, found and resolved in one step. */
export function formworkSettingsFor(nodes: Iterable<AnyNode>): FormworkSettings {
  return formworkSettings(findFormworkSettingsNode(nodes))
}

/** The sub-objects a settings patch can address. */
export type FormworkSettingsGroup =
  | 'concrete'
  | 'placement'
  | 'curing'
  | 'falseworkLoads'
  | 'bracing'
  | 'parts'
  | 'stock'
  | 'rates'
  | 'labour'
  | 'schedule'
  | 'crane'
  | 'logistics'
  | 'sheets'
  | 'concreteSupply'

/**
 * Merge a patch into one of the settings sub-objects, returning the value to write
 * to that key — a merged object, or `undefined` when the group has emptied.
 *
 * This is pure and lives in core because two write paths need the same answer and
 * must not each have their own: the panel edits the live store while the chat tools
 * edit a plain `SceneGraph` on the server, and a disagreement between them about
 * what "unstated" means is a disagreement about whether the design report says
 * "assumed" or "project" — the one distinction the settings node exists to carry.
 *
 * `undefined` in the patch means "hand this field back to the default", so the key
 * is deleted rather than stored holding `undefined`. An emptied group returns
 * `undefined` rather than `{}`, because a stated empty group and an absent one are
 * the same claim and only one of them should be representable.
 *
 * The merge is deliberately one level deep. `concrete.cement` is a second level and
 * has its own helper — a generic deep merge would silently reach into it and there
 * would be no way to clear a nested object at all.
 */
export function mergeFormworkSettingsGroup<G extends FormworkSettingsGroup>(
  current: FormworkProjectSettingsNode[G],
  patch: Partial<NonNullable<FormworkProjectSettingsNode[G]>>,
): FormworkProjectSettingsNode[G] | undefined {
  const merged: Record<string, unknown> = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key]
    else merged[key] = value
  }
  return Object.keys(merged).length > 0
    ? (merged as NonNullable<FormworkProjectSettingsNode[G]>)
    : undefined
}

/**
 * Merge a patch into `concrete.cement`, returning the whole `concrete` value.
 *
 * The binder is a sub-object of a sub-object, which the one-level merge cannot
 * reach: routing it through there writes `cement: { retarder: undefined }`, and an
 * object holding only undefined keys survives as a *stated* empty binder — a claim
 * the project never made. So the second level is merged here, an emptied spec is
 * removed the way an emptied group is, and a stated sibling like a unit weight
 * survives it.
 */
export function mergeFormworkCement(
  current: FormworkProjectSettingsNode['concrete'],
  patch: Partial<NonNullable<NonNullable<FormworkProjectSettingsNode['concrete']>['cement']>>,
): FormworkProjectSettingsNode['concrete'] | undefined {
  const cement: Record<string, unknown> = { ...(current?.cement ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete cement[key]
    else cement[key] = value
  }
  const merged: Record<string, unknown> = { ...(current ?? {}) }
  if (Object.keys(cement).length > 0) merged.cement = cement
  else delete merged.cement
  return Object.keys(merged).length > 0
    ? (merged as NonNullable<FormworkProjectSettingsNode['concrete']>)
    : undefined
}

/**
 * Merge owned quantities into `stock.owned`, returning the whole `stock` value.
 *
 * A second level like the binder, and it cannot go through the one-level merge for a
 * worse reason than the binder's: there, the wrong path writes a stated-empty object;
 * here it would replace the entire rack. `{ owned: { 'panel-a': 200 } }` handed to the
 * generic merge overwrites the `owned` key wholesale, so recording one panel type
 * silently forgets every other type the yard owns — and a stock list is edited one
 * line at a time, which is exactly the case that would lose it.
 *
 * `undefined` against an id removes it, which is how the yard says it no longer owns
 * that type. A zero is kept: "owns none of this" is a fact a yard states about a type
 * it has run out of, and folding it into absence loses the distinction the whole group
 * is built on.
 *
 * An emptied `owned` leaves `stock: {}` rather than deleting the group. That looks
 * inconsistent with `mergeFormworkCement` and is the point: a project that has removed
 * every line from its rack has *stated* it owns nothing, and dropping the group back to
 * absent would turn that statement into "nobody has said" and put the whole bill back
 * on hire. The caller clears the group by patching `stock` itself.
 */
export function mergeFormworkOwnedStock(
  current: FormworkProjectSettingsNode['stock'],
  patch: Readonly<Record<string, number | undefined>>,
): NonNullable<FormworkProjectSettingsNode['stock']> {
  const owned: Record<string, number> = { ...(current?.owned ?? {}) }
  for (const [catalogId, quantity] of Object.entries(patch)) {
    if (quantity === undefined) delete owned[catalogId]
    else owned[catalogId] = quantity
  }
  return { owned }
}

/**
 * Merge rates into `rates`, returning the whole group.
 *
 * `byCatalogId` is the rack's problem again — the generic merge replaces the key
 * wholesale, so recording one panel's price would forget every other price the project
 * has entered, and a rate table is filled in one line at a time. `undefined` against an
 * id removes it, which is how a project drops a part it no longer prices.
 *
 * A rate for one id is *merged* rather than replaced, so stating a hire percentage does
 * not wipe the list price beside it. That is the difference from the rack, where the
 * value is one number: here a part carries a purchase price and a hire term, they are
 * entered at different times by different people, and replacing the object would make
 * filling in the second field delete the first. `null` against a *field* clears just
 * that field, and an emptied rate drops the id rather than leaving `{}` behind — an id
 * with no figures in it is a row nothing can price and nothing reports.
 *
 * The group itself is kept even when the table empties, exactly as `stock` is: a project
 * that has removed every rate has stated it prices nothing, and dropping back to absent
 * would turn that into "nobody has said" and take the money off the takeoff entirely.
 * The caller clears the group by patching `rates` itself.
 */
export function mergeFormworkRates(
  current: FormworkProjectSettingsNode['rates'],
  patch: {
    currency?: string | undefined
    minHireDays?: number | undefined
    gangRatePerHour?: number | undefined
    transportPerLoad?: number | undefined
    cranePerHour?: number | undefined
    byCatalogId?: Readonly<Record<string, Readonly<Record<string, number | undefined>> | undefined>>
  },
  /** Fields explicitly named in the patch, so `undefined` clears rather than skips. */
  stated: {
    currency?: boolean
    minHireDays?: boolean
    gangRatePerHour?: boolean
    transportPerLoad?: boolean
    cranePerHour?: boolean
  } = {},
): NonNullable<FormworkProjectSettingsNode['rates']> {
  const byCatalogId: Record<string, Record<string, number>> = {}
  for (const [catalogId, rate] of Object.entries(current?.byCatalogId ?? {})) {
    byCatalogId[catalogId] = { ...rate }
  }
  for (const [catalogId, rate] of Object.entries(patch.byCatalogId ?? {})) {
    if (rate === undefined) {
      delete byCatalogId[catalogId]
      continue
    }
    const merged: Record<string, number> = { ...(byCatalogId[catalogId] ?? {}) }
    for (const [field, value] of Object.entries(rate)) {
      if (value === undefined) delete merged[field]
      else merged[field] = value
    }
    if (Object.keys(merged).length === 0) delete byCatalogId[catalogId]
    else byCatalogId[catalogId] = merged
  }

  const out: Record<string, unknown> = { byCatalogId }
  const currency = stated.currency ? patch.currency : (patch.currency ?? current?.currency)
  const minHireDays = stated.minHireDays
    ? patch.minHireDays
    : (patch.minHireDays ?? current?.minHireDays)
  const gangRate = stated.gangRatePerHour
    ? patch.gangRatePerHour
    : (patch.gangRatePerHour ?? current?.gangRatePerHour)
  const perLoad = stated.transportPerLoad
    ? patch.transportPerLoad
    : (patch.transportPerLoad ?? current?.transportPerLoad)
  const perHour = stated.cranePerHour
    ? patch.cranePerHour
    : (patch.cranePerHour ?? current?.cranePerHour)
  if (currency !== undefined) out.currency = currency
  if (minHireDays !== undefined) out.minHireDays = minHireDays
  if (gangRate !== undefined) out.gangRatePerHour = gangRate
  if (perLoad !== undefined) out.transportPerLoad = perLoad
  if (perHour !== undefined) out.cranePerHour = perHour
  return out as NonNullable<FormworkProjectSettingsNode['rates']>
}

/**
 * Merge output norms into `labour.byPartKind`, returning the whole group.
 *
 * `byPartKind` is the rate table's problem in a smaller table: the generic merge replaces
 * the key wholesale, so stating the panel norm would forget the norms for every other
 * kind, and a norm table is filled in one row at a time by whoever knows that trade.
 *
 * A kind's entry is *merged* rather than replaced, so recording a strike time does not
 * wipe the erect time beside it — the case the erect-only gap exists to report, and the
 * one a replace would create silently. `undefined` against a kind removes the row;
 * `undefined` against a field clears just that field, and a row left with no hours in it
 * is dropped rather than kept as `{}`, because an empty norm and no norm price the same
 * and only one of them should be representable.
 *
 * The group survives an emptied table, exactly as `stock` and `rates` do: a project that
 * has deleted every norm has stated it has none, and dropping back to absent would turn
 * that into "nobody has said".
 */
export function mergeFormworkLabourNorms(
  current: FormworkProjectSettingsNode['labour'],
  patch: Readonly<Record<string, Readonly<Record<string, number | undefined>> | undefined>>,
): NonNullable<FormworkProjectSettingsNode['labour']> {
  const byPartKind: Record<string, Record<string, number>> = {}
  for (const [kind, norm] of Object.entries(current?.byPartKind ?? {})) {
    byPartKind[kind] = { ...norm }
  }
  for (const [kind, norm] of Object.entries(patch)) {
    if (norm === undefined) {
      delete byPartKind[kind]
      continue
    }
    const merged: Record<string, number> = { ...(byPartKind[kind] ?? {}) }
    for (const [field, value] of Object.entries(norm)) {
      if (value === undefined) delete merged[field]
      else merged[field] = value
    }
    if (Object.keys(merged).length === 0) delete byPartKind[kind]
    else byPartKind[kind] = merged
  }
  return { byPartKind } as NonNullable<FormworkProjectSettingsNode['labour']>
}
