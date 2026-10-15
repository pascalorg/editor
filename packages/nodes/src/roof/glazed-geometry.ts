import { isGlazedRoofSegment, type RoofSegmentNode } from '@pascal-app/core'
import type { RoofGeometryAdapter } from '@pascal-app/viewer'
import type { Mesh } from 'three'

export const glazedRoofGeometryAdapter: RoofGeometryAdapter = {
  syncGeometry(node: RoofSegmentNode, mesh: Mesh) {
    if (isGlazedRoofSegment(node)) syncGlazedRoofShadow(mesh)
  },
}

export function syncGlazedRoofShadow(mesh: Mesh, appearance = mesh.material) {
  const shadow = mesh.getObjectByName('glazed-roof-shadow') as Mesh | undefined
  if (!shadow) return
  const materials = Array.isArray(appearance) ? appearance : [appearance]
  const indices: number[] = []
  for (const group of mesh.geometry.groups) {
    const material = materials[group.materialIndex ?? 0]
    if (material?.transparent && material.opacity < 1) continue
    for (let i = group.start; i < group.start + group.count; i++)
      indices.push(mesh.geometry.index ? mesh.geometry.index.getX(i) : i)
  }
  const geometry = mesh.geometry.clone()
  geometry.clearGroups()
  geometry.setIndex(indices)
  geometry.setDrawRange(0, indices.length)
  shadow.geometry.dispose()
  shadow.geometry = geometry
}
