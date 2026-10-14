import { type AnyNode, isGlazedRoofSegment, type RoofSegmentNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import type { BufferGeometry, Mesh } from 'three'

/** The adapter, placement previews and public roof generator share one geometry kernel. */
export function buildGlazedRoofGeometry(
  node: RoofSegmentNode,
  nodes: Readonly<Record<string, AnyNode>> = {},
): BufferGeometry {
  return generateRoofSegmentGeometry(node, nodes as Record<string, AnyNode>)
}

export const glazedRoofGeometryAdapter = {
  independent: (node: RoofSegmentNode) => isGlazedRoofSegment(node) || node.roofType === 'barrel',
  syncGeometry(node: RoofSegmentNode, mesh: Mesh) {
    if (isGlazedRoofSegment(node)) syncGlazedRoofShadow(mesh)
  },
  buildGeometry: (node: RoofSegmentNode, nodes: Record<string, AnyNode>) =>
    isGlazedRoofSegment(node) || node.roofType === 'barrel'
      ? buildGlazedRoofGeometry(node, nodes)
      : null,
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
