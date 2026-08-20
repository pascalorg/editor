import type {
  CupolaMaterialRole,
  CupolaNode,
  MaterialSchema,
  PaintCapability,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef } from '@pascal-app/viewer'
import type { Material, Mesh, Object3D } from 'three'
import { CUPOLA_MATERIAL_INDEX } from './geometry'

export function resolveCupolaMaterialRole(materialIndex: number | null): CupolaMaterialRole {
  if (materialIndex === CUPOLA_MATERIAL_INDEX.body) return 'body'
  if (materialIndex === CUPOLA_MATERIAL_INDEX.roof) return 'roof'
  return 'base'
}

export function buildCupolaMaterialPatch(
  role: CupolaMaterialRole,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<CupolaNode> {
  if (role === 'body') return { bodyMaterial: material, bodyMaterialPreset: materialPreset }
  if (role === 'roof') return { roofMaterial: material, roofMaterialPreset: materialPreset }
  return { baseMaterial: material, baseMaterialPreset: materialPreset }
}

export function getEffectiveCupolaMaterial(
  node: CupolaNode,
  role: CupolaMaterialRole,
): { material: MaterialSchema | undefined; materialPreset: string | undefined } {
  const material =
    role === 'body' ? node.bodyMaterial : role === 'roof' ? node.roofMaterial : node.baseMaterial
  const materialPreset =
    role === 'body'
      ? node.bodyMaterialPreset
      : role === 'roof'
        ? node.roofMaterialPreset
        : node.baseMaterialPreset
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

export const cupolaPaint: PaintCapability = {
  materialTarget: 'cupola',
  resolveRole: ({ materialIndex }) => resolveCupolaMaterialRole(materialIndex),
  buildPatch: ({ role, material, materialPreset }) =>
    buildCupolaMaterialPatch(role as CupolaMaterialRole, material, materialPreset),
  applyPreview: ({ role, material, materialPreset, root }) => {
    const preview = previewMaterial(material, materialPreset)
    if (!preview) return null
    const index = CUPOLA_MATERIAL_INDEX[role as CupolaMaterialRole]
    let restore: (() => void) | null = null
    ;(root as Object3D).traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || mesh.name !== 'cupola-surface' || !Array.isArray(mesh.material)) return
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
    getEffectiveCupolaMaterial(node as CupolaNode, role as CupolaMaterialRole),
}
