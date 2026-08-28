import type { LeanToExtensionNode } from '@pascal-app/core'
import { type Group, type Material, Mesh, MeshBasicMaterial } from 'three'
import { buildLeanToExtensionGeometry } from './geometry'

export const LEAN_TO_GHOST_COLOR = 0x6c_a3_ff
export const LEAN_TO_INVALID_GHOST_COLOR = 0xef_44_44

export function buildLeanToExtensionPreviewGeometry(
  node: LeanToExtensionNode,
  invalid = false,
): Group {
  const group = buildLeanToExtensionGeometry(node, undefined, 'rendered', false)
  group.name = 'lean-to-extension-preview'
  const material = new MeshBasicMaterial({
    color: invalid ? LEAN_TO_INVALID_GHOST_COLOR : LEAN_TO_GHOST_COLOR,
    depthTest: false,
    depthWrite: false,
    opacity: invalid ? 0.38 : 0.3,
    transparent: true,
  })
  const replacedMaterials = new Set<Material>()
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const source of materials) replacedMaterials.add(source)
    object.material = material
  })
  for (const source of replacedMaterials) source.dispose()

  return group
}

export function disposeLeanToExtensionPreviewGeometry(root: Group): void {
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of meshMaterials) materials.add(material)
  })
  for (const material of materials) material.dispose()
}
