import type { Object3D } from 'three'

/** Preserve scale and shear when an overlay is portalled outside its source hierarchy. */
export function copyOverlayWorldTransform(source: Object3D, overlay: Object3D) {
  source.updateWorldMatrix(true, false)
  overlay.parent?.updateWorldMatrix(true, false)
  overlay.matrixAutoUpdate = false
  if (overlay.parent) overlay.matrix.copy(overlay.parent.matrixWorld).invert().multiply(source.matrixWorld)
  else overlay.matrix.copy(source.matrixWorld)
  overlay.matrixWorldNeedsUpdate = true
}
