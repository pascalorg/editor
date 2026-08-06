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

/** Hands the whole project back to the shipped defaults. */
export function clearFormworkSettings(): void {
  writeFormworkSettings(
    () =>
      ({
        pressureStandard: undefined,
        measurementStandard: undefined,
        concrete: undefined,
        placement: undefined,
        falseworkLoads: undefined,
        bracing: undefined,
        parts: undefined,
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
  clearAll: typeof clearFormworkSettings
} {
  return useMemo(
    () => ({
      setField: setFormworkSettingsField,
      setGroupField: setFormworkSettingsGroupField,
      setCementField: setFormworkCementField,
      clearAll: clearFormworkSettings,
    }),
    [],
  )
}
