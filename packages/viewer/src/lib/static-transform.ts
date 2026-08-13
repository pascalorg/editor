import type { Object3D } from 'three'

/**
 * Freeze an object's local matrix: stamp the current transform, then stop the
 * per-frame recompute. Three's `updateMatrixWorld` walks every object every
 * frame and recomposes the local matrix of each one with `matrixAutoUpdate`
 * on — in a ~5 000-node scene that recompose was ~7 % of frame time for
 * objects that had not moved in minutes.
 *
 * THE TRAP, in stamping order: `matrixAutoUpdate = false` FIRST and the
 * object keeps whatever matrix it had — often identity — and renders at the
 * origin. `updateMatrix()` must run first (it also raises
 * `matrixWorldNeedsUpdate`, so the world matrix refreshes once). The same
 * trap applies to every later imperative write against a frozen object:
 * setting `position`/`rotation` fields alone changes nothing on screen until
 * someone stamps — which is why the imperative writers (wall geometry
 * updates, the floor-elevation lift) re-stamp after they write.
 */
export function freezeObjectTransform(object: Object3D) {
  object.updateMatrix()
  object.matrixAutoUpdate = false
}

/** Undo the freeze: recompute per frame again, starting with the next one. */
export function thawObjectTransform(object: Object3D) {
  if (object.matrixAutoUpdate) return
  object.matrixAutoUpdate = true
  object.matrixWorldNeedsUpdate = true
}

/**
 * Stamp after an imperative transform write that may target a frozen object.
 * No-op on auto-updating objects, so writers can call it unconditionally.
 */
export function stampFrozenTransform(object: Object3D) {
  if (!object.matrixAutoUpdate) object.updateMatrix()
}
