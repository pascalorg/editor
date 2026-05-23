import type * as THREE from 'three'
import { type Brush, Evaluator } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'

/**
 * Shared CSG primitives used by kinds whose geometry subtracts pieces
 * against their host (chimney trimmed by the roof shell, skylight
 * frame as a ring cut from a box, etc.). Lives in viewer because
 * three-bvh-csg + three-mesh-bvh are viewer-only deps; kinds living
 * in `@pascal-app/nodes` import these through the public surface.
 */

export function csgGeometry(brush: Brush): THREE.BufferGeometry {
  return brush.geometry as unknown as THREE.BufferGeometry
}

export function csgMaterials(brush: Brush): THREE.Material[] {
  const mat = (brush as unknown as { material: THREE.Material | THREE.Material[] }).material
  return Array.isArray(mat) ? mat : [mat]
}

export const csgEvaluator = new Evaluator()
csgEvaluator.useGroups = true
;(csgEvaluator as unknown as { consolidateGroups: boolean }).consolidateGroups = false
csgEvaluator.attributes = ['position', 'normal', 'uv']

export function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
    computeBoundsTree
  ;(
    geometry as unknown as { computeBoundsTree: (opts: { maxLeafSize: number }) => void }
  ).computeBoundsTree({ maxLeafSize: 10 })
}

export function prepareBrushForCSG(brush: Brush) {
  computeGeometryBoundsTree(brush.geometry)
  brush.updateMatrixWorld()
}

// Re-export Brush + SUBTRACTION + ADDITION so kinds don't need a direct
// `three-bvh-csg` dependency.
export { ADDITION, Brush, SUBTRACTION } from 'three-bvh-csg'
