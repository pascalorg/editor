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
  return brush.geometry
}

export function csgMaterials(brush: Brush): THREE.Material[] {
  const mat = brush.material
  return Array.isArray(mat) ? mat : [mat]
}

export const csgEvaluator = new Evaluator()
csgEvaluator.useGroups = true
csgEvaluator.consolidateGroups = false
csgEvaluator.attributes = ['position', 'normal', 'uv']

export function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  // See scene-bvh.tsx: two `three-mesh-bvh` versions augment `three` (0.8.3 via
  // three-bvh-csg vs 0.9.9 direct), so the merged `computeBoundsTree` signature
  // (`=> MeshBVH`) rejects the 0.9.9 helper. Bind the runtime helper and call
  // the 0.9.9 import directly so `maxLeafSize` resolves against its options.
  geometry.computeBoundsTree = computeBoundsTree as unknown as typeof geometry.computeBoundsTree
  computeBoundsTree.call(geometry, { maxLeafSize: 10 })
}

export function prepareBrushForCSG(brush: Brush) {
  computeGeometryBoundsTree(brush.geometry)
  brush.updateMatrixWorld()
}

// Re-export Brush + SUBTRACTION + ADDITION so kinds don't need a direct
// `three-bvh-csg` dependency.
export { ADDITION, Brush, SUBTRACTION } from 'three-bvh-csg'
