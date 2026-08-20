import type {
  EyebrowVentMaterialRole,
  EyebrowVentNode,
  MaterialSchema,
  PaintCapability,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D } from 'three'
import { EYEBROW_VENT_MATERIAL_INDEX } from './geometry'

export function resolveEyebrowVentMaterialRole(
  materialIndex: number | null,
): EyebrowVentMaterialRole {
  return materialIndex === EYEBROW_VENT_MATERIAL_INDEX.front ? 'front' : 'hood'
}

export function buildEyebrowVentMaterialPatch(
  role: EyebrowVentMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<EyebrowVentNode> {
  return role === 'front'
    ? { frontMaterial: material, frontMaterialPreset: materialPreset }
    : { hoodMaterial: material, hoodMaterialPreset: materialPreset }
}

export function getEffectiveEyebrowVentMaterial(
  node: EyebrowVentNode,
  role: EyebrowVentMaterialRole,
): { material: MaterialSchema | undefined; materialPreset: string | undefined } {
  const material = role === 'front' ? node.frontMaterial : node.hoodMaterial
  const materialPreset = role === 'front' ? node.frontMaterialPreset : node.hoodMaterialPreset
  return material !== undefined || materialPreset !== undefined
    ? { material, materialPreset }
    : { material: node.material, materialPreset: node.materialPreset }
}

function previewMaterial(
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Material | null {
  if (materialPreset) return createMaterialFromPresetRef(materialPreset)
  if (material) return createMaterial(material)
  return null
}

export const eyebrowVentPaint: PaintCapability = {
  materialTarget: 'eyebrow-vent',
  resolveRole: ({ materialIndex }) => resolveEyebrowVentMaterialRole(materialIndex),
  buildPatch: ({ role, material, materialPreset }) =>
    buildEyebrowVentMaterialPatch(role as EyebrowVentMaterialRole, material, materialPreset),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = previewMaterial(material, materialPreset)
    if (!preview) return null
    const index = EYEBROW_VENT_MATERIAL_INDEX[role as EyebrowVentMaterialRole]
    let restore: (() => void) | null = null
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== 'eyebrow-vent-surface' || !Array.isArray(mesh.material))
        return
      const previous = [...mesh.material]
      const next = [...previous]
      next[index] = preview
      mesh.material = next
      restore = () => {
        mesh.material = previous
      }
    })
    return restore
  },
  getEffectiveMaterial: ({ node, role }) =>
    getEffectiveEyebrowVentMaterial(node as EyebrowVentNode, role as EyebrowVentMaterialRole),
}
