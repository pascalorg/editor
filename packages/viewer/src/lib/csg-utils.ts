import * as THREE from 'three'
import { type Brush, Evaluator } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'

/**
 * Shared CSG primitives used by kinds whose geometry subtracts pieces
 * against their host (chimney trimmed by the roof shell, skylight
 * frame as a ring cut from a box, etc.). Lives in viewer because
 * three-bvh-csg + three-mesh-bvh are viewer-only deps; kinds living
 * in `@pascal-app/nodes` import these through the public surface.
 */

function zeroAttribute(count: number, itemSize: number) {
  return new THREE.Float32BufferAttribute(new Float32Array(count * itemSize), itemSize)
}

function upNormalAttribute(count: number) {
  const values = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    values[index * 3 + 1] = 1
  }
  return new THREE.Float32BufferAttribute(values, 3)
}

function ensureAttributeCount(
  geometry: THREE.BufferGeometry,
  name: string,
  itemSize: number,
  count: number,
) {
  const attribute = geometry.getAttribute(name)
  if (attribute?.count === count && attribute.itemSize === itemSize) return

  geometry.setAttribute(name, zeroAttribute(count, itemSize))
}

function copyVec2Attribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const values = new Float32Array(attribute.count * 2)
  for (let index = 0; index < attribute.count; index += 1) {
    values[index * 2] = attribute.getX(index)
    values[index * 2 + 1] = attribute.getY(index)
  }
  return new THREE.Float32BufferAttribute(values, 2)
}

export function ensureRenderableGeometryAttributes(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0 || position.itemSize !== 3) {
    geometry.setIndex(null)
    geometry.clearGroups()
    geometry.setAttribute('position', zeroAttribute(3, 3))
    geometry.setAttribute('normal', upNormalAttribute(3))
    geometry.setAttribute('uv', zeroAttribute(3, 2))
    geometry.setAttribute('uv2', zeroAttribute(3, 2))
    return geometry
  }

  const count = position.count
  const normal = geometry.getAttribute('normal')
  if (normal?.count !== count || normal.itemSize !== 3) {
    geometry.deleteAttribute('normal')
    try {
      geometry.computeVertexNormals()
    } catch {
      geometry.deleteAttribute('normal')
    }
  }

  const computedNormal = geometry.getAttribute('normal')
  if (computedNormal?.count !== count || computedNormal.itemSize !== 3) {
    geometry.setAttribute('normal', upNormalAttribute(count))
  }
  ensureAttributeCount(geometry, 'uv', 2, count)

  const uv = geometry.getAttribute('uv')
  const uv2 = geometry.getAttribute('uv2')
  if (uv2?.count !== count || uv2.itemSize !== 2) {
    geometry.setAttribute('uv2', copyVec2Attribute(uv))
  }

  return geometry
}

export function csgGeometry(brush: Brush): THREE.BufferGeometry {
  return ensureRenderableGeometryAttributes(brush.geometry as unknown as THREE.BufferGeometry)
}

export function csgMaterials(brush: Brush): THREE.Material[] {
  const mat = (brush as unknown as { material: THREE.Material | THREE.Material[] }).material
  return Array.isArray(mat) ? mat : [mat]
}

export const csgEvaluator = new Evaluator()
csgEvaluator.useGroups = true
;(csgEvaluator as unknown as { consolidateGroups: boolean }).consolidateGroups = false
csgEvaluator.attributes = ['position', 'normal', 'uv', 'uv2']

export function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
    computeBoundsTree
  ;(
    geometry as unknown as { computeBoundsTree: (opts: { maxLeafSize: number }) => void }
  ).computeBoundsTree({ maxLeafSize: 10 })
}

export function prepareBrushForCSG(brush: Brush) {
  ensureRenderableGeometryAttributes(brush.geometry)
  computeGeometryBoundsTree(brush.geometry)
  brush.updateMatrixWorld()
}

// Re-export Brush + SUBTRACTION + ADDITION + INTERSECTION so kinds don't need a
// direct `three-bvh-csg` dependency.
export { ADDITION, Brush, INTERSECTION, SUBTRACTION } from 'three-bvh-csg'
