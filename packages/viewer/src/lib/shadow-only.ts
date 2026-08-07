import type { Object3D } from 'three'
import { hideFromScene, showInScene } from './scene-visibility'

/**
 * Shadow-caster-only hiding: removes an object (and its descendants) from the
 * color passes while keeping it in the shadow map, so a hidden roof or level
 * still shadows the interior and sun enters through windows correctly.
 *
 * Uses layer masks instead of `visible = false` for two reasons: `visible`
 * cascades (and, critically, prunes the object from the shadow pass too),
 * while layers are tested per-object against the rendering camera — the main
 * camera never enables the shadow-only layer, but every shadow-casting
 * light's shadow camera does (see `lights.tsx`).
 *
 * The mask itself belongs to `lib/scene-visibility.ts`, which reconciles this
 * with the isolation filter. Both calls are idempotent and cheap to reapply —
 * solo re-runs `applyShadowOnly` every frame so meshes rebuilt while hidden
 * get re-hidden.
 */
export function applyShadowOnly(root: Object3D): void {
  root.traverse((obj) => {
    hideFromScene(obj, 'shadow-only')
  })
}

export function clearShadowOnly(root: Object3D): void {
  root.traverse((obj) => {
    showInScene(obj, 'shadow-only')
  })
}
