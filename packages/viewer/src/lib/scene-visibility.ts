import type { Object3D } from 'three'
import { BATCHED_LAYER, SCENE_LAYER, SHADOW_ONLY_LAYER } from './layers'

/**
 * Why an object is currently held off the scene layer.
 *
 * - `isolated` — outside the focused subtree of the viewer's isolation filter.
 * - `shadow-only` — solo mode: out of the color passes, still casting shadows.
 * - `batched` — a level's merged wall mesh draws this wall now.
 */
export type HiddenReason = 'isolated' | 'shadow-only' | 'batched' | 'wall-batched'

/**
 * Single owner of `Object3D.layers` for every feature that hides an object.
 *
 * Isolation, solo's shadow-caster pass and wall batching all hide by clearing
 * {@link SCENE_LAYER}, and they overlap freely — a wall can be sewn into a
 * batch, then soloed, then isolated. While each stashed and restored the mask privately, the
 * second to finish wrote back a mask the first had since changed. Recording
 * *reasons* rather than masks makes the order irrelevant: the mask is
 * recomputed from the one snapshot taken when the first reason arrived, and
 * handed back only when the last one leaves.
 */
const HOLD = Symbol('pascal:scene-visibility:hold')

type Hold = { original: number; reasons: Set<HiddenReason> }

type Holder = Object3D & { [HOLD]?: Hold }

/** Holds `obj` off the scene layer for `reason`. Idempotent per reason. */
export function hideFromScene(obj: Object3D, reason: HiddenReason): void {
  const holder = obj as Holder
  const hold = holder[HOLD] ?? { original: obj.layers.mask, reasons: new Set<HiddenReason>() }
  holder[HOLD] = hold
  hold.reasons.add(reason)
  applyHold(obj, hold)
}

/** Drops `reason`, restoring the mask `obj` had before the first one arrived. */
export function showInScene(obj: Object3D, reason: HiddenReason): void {
  const holder = obj as Holder
  const hold = holder[HOLD]
  if (!hold) return

  hold.reasons.delete(reason)
  if (hold.reasons.size > 0) {
    applyHold(obj, hold)
    return
  }

  obj.layers.mask = hold.original
  delete holder[HOLD]
}

function applyHold(obj: Object3D, hold: Hold): void {
  obj.layers.mask = hold.original
  obj.layers.disable(SCENE_LAYER)

  // A batched wall is both drawn and shadowed by the merged mesh, so it stays
  // out of the shadow pass too — enabling the shadow-only bit would submit its
  // triangles a second time, on top of the copy the batch already casts.
  if (hold.reasons.has('batched') || hold.reasons.has('wall-batched')) {
    obj.layers.enable(BATCHED_LAYER)
    return
  }

  if (hold.reasons.has('shadow-only')) obj.layers.enable(SHADOW_ONLY_LAYER)
}
