import { type AnyNode, sceneRegistry } from '@pascal-app/core'
import type { BufferGeometry, Object3D } from 'three'
import { familyForNode } from './scene-families'
import { heldReasons, hideFromScene, showInScene } from './scene-visibility'
import { type SectionState, sectionShadowSignature } from './section'
import { SITE_HORIZON } from './site-surfaces'

export type XrayState = { xrayFamily: string | null; walkthroughMode?: boolean }

export function xrayActive(state: XrayState): boolean {
  return state.xrayFamily !== null && !state.walkthroughMode
}

export function xrayShadowSignature(state: XrayState): string {
  return xrayActive(state) ? state.xrayFamily! : ''
}

/** The default path returns a literal without serializing or concatenating state. */
export function viewerShadowSignature(state: XrayState & SectionState): string {
  const section = sectionShadowSignature(state)
  const xray = xrayShadowSignature(state)
  return section || xray ? `${section}:${xray}` : ''
}

/** Layers do not cascade, so a hidden wall keeps its hosted items and openings. */
export function createFamilyVisibility() {
  let held = new Set<Object3D>()
  let observed = new Set<Object3D>()
  let dirty = true
  let lastRoot: Object3D | undefined
  let lastFamily: string | null | undefined
  let lastVersion: unknown
  let lastRegistry = -1
  const markDirty = () => {
    dirty = true
  }
  const unobserve = (object: Object3D) => {
    object.removeEventListener('childadded', markDirty)
    object.removeEventListener('childremoved', markDirty)
  }
  const clear = () => {
    for (const object of held) showInScene(object, 'xray')
    held.clear()
    for (const object of observed) unobserve(object)
    observed.clear()
    dirty = true
  }
  return {
    clear,
    update(
      root: Object3D,
      ownerOf: (object: Object3D) => AnyNode | undefined,
      state: XrayState,
      version?: unknown,
    ) {
      const family = xrayActive(state) ? state.xrayFamily : null
      if (
        !dirty &&
        root === lastRoot &&
        family === lastFamily &&
        version === lastVersion &&
        lastRegistry === sceneRegistry.revision
      )
        return
      lastRoot = root
      lastFamily = family
      lastVersion = version
      lastRegistry = sceneRegistry.revision
      if (!xrayActive(state)) {
        if (held.size || observed.size) clear()
        dirty = false
        return
      }
      const hidden = new Set<Object3D>()
      const nextObserved = new Set<Object3D>()
      const visit = (object: Object3D, owner?: AnyNode) => {
        nextObserved.add(object)
        if (!observed.has(object)) {
          object.addEventListener('childadded', markDirty)
          object.addEventListener('childremoved', markDirty)
        }
        const node = ownerOf(object) ?? owner
        // Classify each owned draw, rather than guessing from an unloaded definition.
        const draws = Boolean((object as Object3D & { geometry?: BufferGeometry }).geometry)
        const family = node && familyForNode(node, draws)
        // Collective draws have their own member filter / unmerged fallback.
        if (
          !object.userData[SITE_HORIZON] &&
          !object.userData.glbBatch &&
          family !== undefined &&
          family !== state.xrayFamily
        ) {
          hideFromScene(object, 'xray')
          hidden.add(object)
        }
        for (const child of object.children) visit(child, node)
      }
      visit(root)
      for (const object of held) if (!hidden.has(object)) showInScene(object, 'xray')
      held = hidden
      for (const object of observed) if (!nextObserved.has(object)) unobserve(object)
      observed = nextObserved
      dirty = false
    },
  }
}

/** Preserve hit order; originals on the batched layer must also be rejected. */
export function filterXrayHits<T extends { object: Object3D }>(hits: T[], state: XrayState): T[] {
  if (!xrayActive(state)) return hits
  return hits.filter((hit) => !heldReasons(hit.object)?.has('xray'))
}
