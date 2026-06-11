'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { sceneRegistry } from '@pascal-app/core'
import type { Object3D } from 'three'
import { SCENE_LAYER } from './layers'

// Marker on each Object3D we modify during isolation so we can restore
// the original `layers.mask` bitfield. Stored under a `Symbol` so it
// can't collide with any kind's own userData fields.
const ORIGINAL_LAYERS = Symbol('isolation:original-layers')

type IsolationCarrier = Object3D & { [ORIGINAL_LAYERS]?: number }

// Whether a subtree is currently isolated (some objects have SCENE_LAYER
// disabled). Read by consumers that must not act on the partial view — e.g.
// the project-thumbnail autosave skips capturing while isolated so it never
// snapshots a single focused item as the whole project's thumbnail.
let isolationActive = false

/** True while an isolation filter is applied (see {@link applyIsolation}). */
export function isIsolationActive(): boolean {
  return isolationActive
}

/**
 * Compute the union of every isolated subtree's `Object3D` descendants.
 *
 * Pure traversal — exported so future "focus mode" / debug tooling can
 * reuse the same definition of "what's in the isolated set". Each root
 * is walked via `Object3D.traverse` (the live Three.js graph, not the
 * data-model `children` array — those can disagree when systems mount
 * synthesized sub-meshes that the data model doesn't track).
 */
export function collectIsolationSubtree(ids: ReadonlyArray<string>): Set<Object3D> {
  const keep = new Set<Object3D>()
  for (const id of ids) {
    const root = sceneRegistry.nodes.get(id)
    if (!root) continue
    root.traverse((child) => {
      keep.add(child)
    })
  }
  return keep
}

/**
 * Imperative visibility filter on the live `sceneRegistry`. Hides every
 * registered group (and its synthesized child meshes) outside the
 * isolated subtree by disabling the {@link SCENE_LAYER} bit on the
 * relevant `Object3D.layers` masks.
 *
 * Why layers instead of `obj.visible = false`? Three.js's visibility
 * flag *cascades* — hiding a parent hides every descendant — so we
 * can't hide a host wall while keeping a door rendered inside it.
 * Layer masks are per-object and don't cascade: `WebGLRenderer
 * .projectObject` skips objects whose layer mask doesn't intersect the
 * camera's, but always recurses into their children. So we can disable
 * `SCENE_LAYER` on the wall and the door (hosted under it in the
 * scene graph) still renders, with its local position relative to the
 * wall preserved automatically by the matrix walk.
 *
 * The original `layers.mask` is stashed under a private Symbol so
 * {@link clearIsolation} can restore the exact prior state.
 *
 * Pass `null` to clear isolation (equivalent to calling
 * {@link clearIsolation}).
 */
export function applyIsolation(ids: ReadonlyArray<AnyNodeId> | null): void {
  if (ids == null || ids.length === 0) {
    clearIsolation()
    return
  }

  const keep = collectIsolationSubtree(ids as ReadonlyArray<string>)

  // Iterate registered roots. For each one outside the keep set,
  // disable `SCENE_LAYER` on it and on every descendant — *except*
  // descendants that are themselves in `keep` (a kept node nested under
  // a non-kept host: the isolated door under the hidden wall).
  for (const [, obj] of sceneRegistry.nodes) {
    if (keep.has(obj)) continue
    hideRecursive(obj, keep)
  }
  isolationActive = true
}

function hideRecursive(obj: Object3D, keep: Set<Object3D>): void {
  if (keep.has(obj)) return
  const carrier = obj as IsolationCarrier
  if (carrier[ORIGINAL_LAYERS] === undefined) {
    carrier[ORIGINAL_LAYERS] = obj.layers.mask
  }
  obj.layers.disable(SCENE_LAYER)
  for (const child of obj.children) {
    hideRecursive(child, keep)
  }
}

export function clearIsolation(): void {
  // We don't know which objects were touched without re-walking, so
  // walk every registered root + its descendants and restore any
  // stashed original-mask. `traverse` is cheap and idempotent here.
  for (const [, obj] of sceneRegistry.nodes) {
    obj.traverse((child) => {
      const carrier = child as IsolationCarrier
      if (carrier[ORIGINAL_LAYERS] !== undefined) {
        child.layers.mask = carrier[ORIGINAL_LAYERS]
        delete carrier[ORIGINAL_LAYERS]
      }
    })
  }
  isolationActive = false
}
