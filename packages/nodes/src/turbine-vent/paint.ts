import type {
  MaterialSchema,
  PaintCapability,
  TurbineVentMaterialRole,
  TurbineVentNode,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D } from 'three'

export function resolveTurbineVentMaterialRole(hitObjectName?: string): TurbineVentMaterialRole {
  return hitObjectName === 'turbine-vent-head' ? 'head' : 'base'
}

export function buildTurbineVentMaterialPatch(
  role: TurbineVentMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<TurbineVentNode> {
  return role === 'head'
    ? { headMaterial: material, headMaterialPreset: materialPreset }
    : { baseMaterial: material, baseMaterialPreset: materialPreset }
}

export function getEffectiveTurbineVentMaterial(
  node: TurbineVentNode,
  role: TurbineVentMaterialRole,
): { material: MaterialSchema | undefined; materialPreset: string | undefined } {
  const material = role === 'head' ? node.headMaterial : node.baseMaterial
  const materialPreset = role === 'head' ? node.headMaterialPreset : node.baseMaterialPreset
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

export const turbineVentPaint: PaintCapability = {
  materialTarget: 'turbine-vent',
  resolveRole: ({ hitObjectName }) => resolveTurbineVentMaterialRole(hitObjectName),
  buildPatch: ({ role, material, materialPreset }) =>
    buildTurbineVentMaterialPatch(role as TurbineVentMaterialRole, material, materialPreset),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = previewMaterial(material, materialPreset)
    if (!preview) return null
    const targetName = `turbine-vent-${role}`
    const restores: Array<() => void> = []
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== targetName) return
      const previous = mesh.material
      mesh.material = preview
      restores.push(() => {
        mesh.material = previous
      })
    })
    if (restores.length === 0) return null
    return () => {
      for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
    }
  },
  getEffectiveMaterial: ({ node, role }) =>
    getEffectiveTurbineVentMaterial(node as TurbineVentNode, role as TurbineVentMaterialRole),
}
