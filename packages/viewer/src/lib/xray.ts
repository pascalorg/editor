import type { AnyNode } from '@pascal-app/core'
import type { Object3D } from 'three'
import { familyForNode } from './scene-families'
import { heldReasons, hideFromScene, showInScene } from './scene-visibility'

export type XrayState = { xrayFamily: string | null; walkthroughMode?: boolean }

export function xrayActive(state: XrayState): boolean {
  return state.xrayFamily !== null && !state.walkthroughMode
}

export function xrayShadowSignature(state: XrayState): string {
  return JSON.stringify(xrayActive(state) ? state.xrayFamily : null)
}

/** Layers do not cascade, so a hidden wall keeps its hosted items and openings. */
export function createFamilyVisibility() {
  let held = new Set<Object3D>()
  const clear = () => {
    for (const object of held) showInScene(object, 'xray')
    held.clear()
  }
  return {
    clear,
    update(root: Object3D, ownerOf: (object: Object3D) => AnyNode | undefined, state: XrayState) {
      if (!xrayActive(state)) {
        if (held.size) clear()
        return
      }
      const hidden = new Set<Object3D>()
      const visit = (object: Object3D, owner?: AnyNode) => {
        const node = ownerOf(object) ?? owner
        const family = node && familyForNode(node)
        // Collective draws have their own member filter / unmerged fallback.
        if (!object.userData.glbBatch && family !== undefined && family !== state.xrayFamily) {
          hideFromScene(object, 'xray')
          hidden.add(object)
        }
        for (const child of object.children) visit(child, node)
      }
      visit(root)
      for (const object of held) if (!hidden.has(object)) showInScene(object, 'xray')
      held = hidden
    },
  }
}

/** Preserve hit order; originals on the batched layer must also be rejected. */
export function filterXrayHits<T extends { object: Object3D }>(hits: T[], state: XrayState): T[] {
  if (!xrayActive(state)) return hits
  return hits.filter((hit) => !heldReasons(hit.object)?.has('xray'))
}
