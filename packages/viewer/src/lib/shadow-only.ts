import type { Object3D } from 'three'
import { SCENE_LAYER, SHADOW_ONLY_LAYER } from './layers'

/**
 * Shadow-caster-only hiding: removes an object (and its descendants) from the
 * color passes while keeping it in the shadow map, so a hidden roof or level
 * still shadows the interior and sun enters through windows correctly.
 *
 * Uses layer masks instead of `visible = false` for two reasons: `visible`
 * cascades (and, critically, prunes the object from the shadow pass too),
 * while layers are tested per-object against the rendering camera — the main
 * camera never enables {@link SHADOW_ONLY_LAYER}, but every shadow-casting
 * light's shadow camera does (see `lights.tsx`).
 *
 * The original `layers.mask` is stashed under a private Symbol so
 * {@link clearShadowOnly} restores the exact prior state. Both calls are
 * idempotent and cheap to reapply.
 */

const ORIGINAL_LAYERS = Symbol('pascal:shadow-only:original-layers')

type ShadowOnlyCarrier = Object3D & { [ORIGINAL_LAYERS]?: number }

export function applyShadowOnly(root: Object3D): void {
  root.traverse((obj) => {
    const carrier = obj as ShadowOnlyCarrier
    if (carrier[ORIGINAL_LAYERS] === undefined) {
      carrier[ORIGINAL_LAYERS] = obj.layers.mask
    }
    obj.layers.disable(SCENE_LAYER)
    obj.layers.enable(SHADOW_ONLY_LAYER)
  })
}

export function clearShadowOnly(root: Object3D): void {
  root.traverse((obj) => {
    const carrier = obj as ShadowOnlyCarrier
    if (carrier[ORIGINAL_LAYERS] === undefined) return
    obj.layers.mask = carrier[ORIGINAL_LAYERS]
    delete carrier[ORIGINAL_LAYERS]
  })
}
