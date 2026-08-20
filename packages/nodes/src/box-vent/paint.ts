import type {
  BoxVentMaterialRole,
  BoxVentNode,
  MaterialSchema,
  PaintCapability,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D } from 'three'
import { BOX_VENT_MATERIAL_INDEX } from './geometry'

export function resolveBoxVentMaterialRole(materialIndex: number | null): BoxVentMaterialRole {
  return materialIndex === BOX_VENT_MATERIAL_INDEX.top ? 'top' : 'base'
}

export function buildBoxVentMaterialPatch(
  role: BoxVentMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<BoxVentNode> {
  return role === 'top'
    ? { topMaterial: material, topMaterialPreset: materialPreset }
    : { baseMaterial: material, baseMaterialPreset: materialPreset }
}

export function getEffectiveBoxVentMaterial(
  node: BoxVentNode,
  role: BoxVentMaterialRole,
): { material: MaterialSchema | undefined; materialPreset: string | undefined } {
  const material = role === 'top' ? node.topMaterial : node.baseMaterial
  const materialPreset = role === 'top' ? node.topMaterialPreset : node.baseMaterialPreset
  if (material !== undefined || materialPreset !== undefined) {
    return { material, materialPreset }
  }
  return { material: node.material, materialPreset: node.materialPreset }
}

function buildPreviewMaterial(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Material | null {
  if (materialPreset) return createMaterialFromPresetRef(materialPreset)
  if (material) return createMaterial(material)
  return null
}

function applyBoxVentPreview(
  role: BoxVentMaterialRole,
  previewMaterial: Material,
  root: Object3D,
): (() => void) | null {
  const materialIndex = BOX_VENT_MATERIAL_INDEX[role]
  const restores: Array<() => void> = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.name !== 'box-vent-surface' || !Array.isArray(mesh.material)) return
    const previous = [...mesh.material]
    if (!previous[materialIndex]) return
    const next = [...previous]
    next[materialIndex] = previewMaterial
    mesh.material = next
    restores.push(() => {
      mesh.material = previous
    })
  })
  if (restores.length === 0) return null
  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}

export const boxVentPaint: PaintCapability = {
  materialTarget: 'box-vent',
  resolveRole: ({ materialIndex }) => resolveBoxVentMaterialRole(materialIndex),
  buildPatch: ({ role, material, materialPreset }) =>
    buildBoxVentMaterialPatch(role as BoxVentMaterialRole, material, materialPreset),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const previewMaterial = buildPreviewMaterial(material, materialPreset)
    if (!previewMaterial) return null
    return applyBoxVentPreview(role as BoxVentMaterialRole, previewMaterial, root)
  },
  getEffectiveMaterial: ({ node, role }) =>
    getEffectiveBoxVentMaterial(node as BoxVentNode, role as BoxVentMaterialRole),
}
