import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import type { AnyNode } from '../../schema/types'
import { DEFAULT_MEASUREMENT_STANDARD_ID, type MeasurementStandardId } from './measurement'
import {
  DEFAULT_PRESSURE_STANDARD_ID,
  DIN_MAX_RISE_RATE_MH,
  type Placement,
  type PressureStandardId,
} from './pressure'

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
export function formworkSettings(
  node: FormworkProjectSettingsNode | undefined,
): FormworkSettings {
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
