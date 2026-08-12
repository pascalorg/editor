'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CementSpecSettings,
  type FormworkProjectSettingsNode,
  type FormworkSettingsGroup,
  findFormworkSettingsNode,
  generateId,
  mergeFormworkCement,
  mergeFormworkLabourNorms,
  mergeFormworkOwnedStock,
  mergeFormworkRates,
  mergeFormworkSettingsGroup,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { useMemo } from 'react'

/**
 * Reading and writing the project's pour.
 *
 * Three things about this write are not obvious, and each one fails quietly:
 *
 * 1. **The node is created on first write, parented to the site.** `setScene`
 *    sweeps any node whose `parentId` names a node that is not in the scene, so an
 *    unparented settings node survives the session and vanishes on reload — the
 *    project's pour silently reverting to the defaults between two openings of the
 *    same file. The site is the right parent because the pour is a property of the
 *    project rather than of a building or a level: two buildings on one site are
 *    poured by the same plant at the same temperature.
 * 2. **Every assembly in the scene is dirtied, not the settings node.** A design
 *    input lives outside the shutters it sizes, and `updateNode` marks only the
 *    edited node and its parent. `dirty-scope.ts` reaches one level, which is
 *    right for a cast-order edit and wrong here: the rate of rise sizes every
 *    shutter on every level at once. Without the sweep the design report re-reads
 *    the settings immediately while the 3D shutters keep the spacings they were
 *    built with, and the two disagree on screen. Marking the settings node itself
 *    would do nothing — it is registered `dirtyTracking: false`, and `markDirty`
 *    drops those silently.
 * 3. **Unset stays unset.** The patch deletes a key rather than writing a default
 *    into it, because `stated` is what lets the report say "assumed" — a panel that
 *    filled in the shipped figures would convert every assumption in the project
 *    into a claim without the user saying anything.
 *
 * The writes are module functions rather than closures inside the hook so all three
 * are reachable from a test without a React renderer. Every one of them is a bug
 * that leaves the UI looking correct.
 */

/** Every formwork assembly in the scene. A settings edit re-sizes all of them. */
function allFormworkAssemblies(nodes: Record<string, AnyNode>): AnyNodeId[] {
  const out: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (node.type === 'formwork-assembly') out.push(node.id as AnyNodeId)
  }
  return out
}

/** The site, which owns the settings node. */
function findSiteId(nodes: Record<string, AnyNode>, rootNodeIds: string[]): AnyNodeId | undefined {
  for (const id of rootNodeIds) {
    if (nodes[id]?.type === 'site') return id as AnyNodeId
  }
  return undefined
}

/**
 * Apply a patch to the settings node, creating it if this is the project's first
 * stated field, and dirty every assembly the change re-sizes.
 *
 * The write goes through `getState()` rather than through subscribed actions so the
 * panel's callbacks stay stable and a field does not re-render its siblings on every
 * keystroke. Creation and update are one history step, so an undo after the first
 * ever edit leaves no empty settings node behind.
 *
 * A scene with no site is left alone: that is the pre-load state, and creating an
 * unparented node there is exactly the orphan the sweep would eat.
 */
export function writeFormworkSettings(
  mutate: (node: FormworkProjectSettingsNode) => Partial<AnyNode>,
): void {
  runAsSingleSceneHistoryStep(useScene, () => {
    const scene = useScene.getState()
    let node = findFormworkSettingsNode(Object.values(scene.nodes))
    if (!node) {
      const siteId = findSiteId(scene.nodes, scene.rootNodeIds as string[])
      if (!siteId) return
      const created = {
        object: 'node',
        id: generateId('formwork-settings'),
        type: 'formwork-settings',
        parentId: siteId,
        visible: true,
        metadata: {},
        children: [],
      } as unknown as FormworkProjectSettingsNode
      scene.createNode(created as unknown as AnyNode, siteId)
      node = useScene.getState().nodes[created.id as AnyNodeId] as
        | FormworkProjectSettingsNode
        | undefined
      if (!node) return
    }
    scene.updateNode(node.id as AnyNodeId, mutate(node))
    const after = useScene.getState()
    for (const id of allFormworkAssemblies(after.nodes)) after.markDirty(id)
  })
}

/** Writes a top-level field — the two standards. */
export function setFormworkSettingsField<K extends 'pressureStandard' | 'measurementStandard'>(
  key: K,
  value: FormworkProjectSettingsNode[K],
): void {
  writeFormworkSettings(() => ({ [key]: value }) as Partial<AnyNode>)
}

/**
 * Merge a patch into one of the settings sub-objects, with `undefined` meaning "hand
 * this field back to the default".
 *
 * `updateNode` replaces a whole nested object, so writing `{ concrete: { slumpMm:
 * 180 } }` would drop a stated consistency class alongside it. The merge itself is
 * core's, shared with the chat tools — the two write paths must agree on what
 * "unstated" means or the design report's "assumed" / "project" distinction depends
 * on which one made the edit.
 */
export function setFormworkSettingsGroupField<G extends FormworkSettingsGroup>(
  group: G,
  patch: Partial<NonNullable<FormworkProjectSettingsNode[G]>>,
): void {
  writeFormworkSettings(
    (node) => ({ [group]: mergeFormworkSettingsGroup(node[group], patch) }) as Partial<AnyNode>,
  )
}

/** Merge into `concrete.cement`, the second nesting level the group merge cannot reach. */
export function setFormworkCementField(patch: Partial<CementSpecSettings>): void {
  writeFormworkSettings(
    (node) => ({ concrete: mergeFormworkCement(node.concrete, patch) }) as Partial<AnyNode>,
  )
}

/**
 * Record what the yard owns of one or more catalog ids. `undefined` removes an id.
 *
 * The rack is edited one line at a time, which is the case the group merge would lose:
 * it replaces `owned` wholesale, so adding a panel type would forget the rest of the
 * yard. And unlike every other write here, an emptied rack is *kept* as `stock: {}` —
 * a project that has removed every line has stated it owns nothing, which is an answer,
 * where an absent group means nobody has said and the takeoff shows no split at all.
 */
export function setFormworkOwnedStock(patch: Record<string, number | undefined>): void {
  writeFormworkSettings(
    (node) => ({ stock: mergeFormworkOwnedStock(node.stock, patch) }) as Partial<AnyNode>,
  )
}

/** Drops the rack back to unstated, which is not the same as recording a rack of nothing. */
export function clearFormworkOwnedStock(): void {
  writeFormworkSettings(() => ({ stock: undefined }) as Partial<AnyNode>)
}

/**
 * Record what one catalog part costs. `undefined` for the rate removes the id, `null` for
 * a field clears just that field.
 *
 * Two levels of merge, unlike the rack's one, and the second level is why: a part carries
 * a list price and a hire term, they come from different documents at different times, and
 * replacing the rate object would make filling in the second figure delete the first. So
 * `null` is a real value here — it is the only way to say "clear this one field" in a patch
 * whose absent keys mean "leave alone".
 */
export function setFormworkRate(
  catalogId: string,
  patch: Record<string, number | null> | undefined,
): void {
  writeFormworkSettings((node) => {
    const fields =
      patch === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]),
          )
    return {
      rates: mergeFormworkRates(node.rates, { byCatalogId: { [catalogId]: fields } }),
    } as Partial<AnyNode>
  })
}

/**
 * Record the agreement's own terms — the currency and the minimum hire period.
 *
 * On the group rather than on each part because a minimum hire period is a term of an
 * agreement, not a property of a product, and repeating it against forty ids is
 * thirty-nine copies that go stale. An empty patch opens the group without stating
 * anything in it, which is the difference between a project that has looked at its rates
 * and one that never has.
 */
export function setFormworkRateTerms(patch: {
  currency?: string | null
  minHireDays?: number | null
}): void {
  writeFormworkSettings(
    (node) =>
      ({
        rates: mergeFormworkRates(
          node.rates,
          {
            ...('currency' in patch ? { currency: patch.currency ?? undefined } : {}),
            ...('minHireDays' in patch ? { minHireDays: patch.minHireDays ?? undefined } : {}),
          },
          { currency: 'currency' in patch, minHireDays: 'minHireDays' in patch },
        ),
      }) as Partial<AnyNode>,
  )
}

/** Drops the rates back to unstated, which takes the money off the takeoff entirely. */
export function clearFormworkRates(): void {
  writeFormworkSettings(() => ({ rates: undefined }) as Partial<AnyNode>)
}

/**
 * Record what one man-hour of the gang costs, all-in.
 *
 * On `rates` rather than beside the norms it prices, because it is money and the currency
 * it is in lives there — a second currency field for labour is how a takeoff ends up
 * totalling two kinds of money. `null` clears it, which leaves the hours with no cost
 * against them rather than costing them at nothing.
 */
export function setFormworkGangRate(value: number | null): void {
  writeFormworkSettings(
    (node) =>
      ({
        rates: mergeFormworkRates(
          node.rates,
          { gangRatePerHour: value ?? undefined },
          { gangRatePerHour: true },
        ),
      }) as Partial<AnyNode>,
  )
}

/**
 * Record what a delivery load and an hour of the crane cost. `null` clears one figure.
 *
 * Both on `rates` rather than beside the payload and the cycle time they multiply, for the
 * gang rate's reason: they are money, and the currency they are denominated in lives there.
 * Field by field rather than as a group, because the haulier's quote and the crane hire come
 * from two desks — replacing the pair would make filling in the second delete the first.
 */
export function setFormworkLogisticsRates(patch: {
  transportPerLoad?: number | null
  cranePerHour?: number | null
}): void {
  writeFormworkSettings(
    (node) =>
      ({
        rates: mergeFormworkRates(
          node.rates,
          {
            ...('transportPerLoad' in patch
              ? { transportPerLoad: patch.transportPerLoad ?? undefined }
              : {}),
            ...('cranePerHour' in patch ? { cranePerHour: patch.cranePerHour ?? undefined } : {}),
          },
          {
            transportPerLoad: 'transportPerLoad' in patch,
            cranePerHour: 'cranePerHour' in patch,
          },
        ),
      }) as Partial<AnyNode>,
  )
}

/**
 * Record this project's own output norm for one kind of part. `null` clears one figure.
 *
 * Keyed by kind rather than by catalog id, because fitting a 0.6 m panel and a 0.9 m one is
 * the same operation to a carpenter — and keyed by *field*, for the rate table's reason:
 * the strike figure arrives after the erect figure and replacing the row would delete it.
 */
export function setFormworkLabourNorm(
  kind: string,
  patch: Record<string, number | null> | undefined,
): void {
  writeFormworkSettings((node) => {
    const fields =
      patch === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]),
          )
    return {
      labour: mergeFormworkLabourNorms(node.labour, { [kind]: fields }),
    } as Partial<AnyNode>
  })
}

/**
 * Drops the norms back to unstated, which takes the labour off the takeoff entirely.
 *
 * Not the gang rate, which lives with the money: clearing the norms leaves a rate that
 * prices nothing, and that resolves to no labour block at all rather than to zero hours.
 */
export function clearFormworkLabourNorms(): void {
  writeFormworkSettings(() => ({ labour: undefined }) as Partial<AnyNode>)
}

/** Hands the whole project back to the shipped defaults. */
export function clearFormworkSettings(): void {
  writeFormworkSettings(
    () =>
      ({
        pressureStandard: undefined,
        measurementStandard: undefined,
        concrete: undefined,
        placement: undefined,
        curing: undefined,
        falseworkLoads: undefined,
        bracing: undefined,
        parts: undefined,
        stock: undefined,
        rates: undefined,
        labour: undefined,
        schedule: undefined,
        crane: undefined,
        logistics: undefined,
      }) as Partial<AnyNode>,
  )
}

export function useFormworkSettingsNode(): FormworkProjectSettingsNode | undefined {
  return useScene((s) => findFormworkSettingsNode(Object.values(s.nodes)))
}

export function useFormworkSettingsWriter(): {
  setField: typeof setFormworkSettingsField
  setGroupField: typeof setFormworkSettingsGroupField
  setCementField: typeof setFormworkCementField
  setOwnedStock: typeof setFormworkOwnedStock
  clearOwnedStock: typeof clearFormworkOwnedStock
  setRate: typeof setFormworkRate
  setRateTerms: typeof setFormworkRateTerms
  clearRates: typeof clearFormworkRates
  setGangRate: typeof setFormworkGangRate
  setLogisticsRates: typeof setFormworkLogisticsRates
  setLabourNorm: typeof setFormworkLabourNorm
  clearLabourNorms: typeof clearFormworkLabourNorms
  clearAll: typeof clearFormworkSettings
} {
  return useMemo(
    () => ({
      setField: setFormworkSettingsField,
      setGroupField: setFormworkSettingsGroupField,
      setCementField: setFormworkCementField,
      setOwnedStock: setFormworkOwnedStock,
      clearOwnedStock: clearFormworkOwnedStock,
      setRate: setFormworkRate,
      setRateTerms: setFormworkRateTerms,
      clearRates: clearFormworkRates,
      setGangRate: setFormworkGangRate,
      setLogisticsRates: setFormworkLogisticsRates,
      setLabourNorm: setFormworkLabourNorm,
      clearLabourNorms: clearFormworkLabourNorms,
      clearAll: clearFormworkSettings,
    }),
    [],
  )
}
