import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import type { AnyNode } from '../../schema/types'
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
  falseworkLoads: {},
  bracing: {},
  parts: {},
  ownedStock: undefined,
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
    falseworkLoads: node.falseworkLoads ?? {},
    bracing: node.bracing ?? {},
    parts: node.parts ?? {},
    ownedStock: node.stock?.owned,
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
  | 'falseworkLoads'
  | 'bracing'
  | 'parts'
  | 'stock'

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
